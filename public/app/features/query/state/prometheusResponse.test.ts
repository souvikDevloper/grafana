import { createDataFrame, type DataFrame, FieldType } from '@grafana/data';

import { isDataFrameResponse, prometheusResponseToDataFrames } from './prometheusResponse';

describe('isDataFrameResponse', () => {
  it('is true for an object whose data is an array (empty or populated)', () => {
    expect(isDataFrameResponse({ data: [] })).toBe(true);
    expect(
      isDataFrameResponse({
        data: [createDataFrame({ refId: 'A', fields: [{ name: 'Value', type: FieldType.number, values: [1] }] })],
      })
    ).toBe(true);
  });

  it.each([
    ['a prometheus body (data is an object, not an array)', { data: { resultType: 'matrix', result: [] } }],
    ['null', null],
    ['undefined', undefined],
    ['a plain object without data', { foo: 1 }],
    ['a string', 'nope'],
    ['a number', 42],
  ])('is false for %s', (_desc, input) => {
    expect(isDataFrameResponse(input)).toBe(false);
  });
});

describe('prometheusResponseToDataFrames', () => {
  // The Time field is always ms (seconds * 1000) and precedes the Value field.
  function expectTimeValueFrame(frame: DataFrame) {
    expect(frame.fields.map((f) => f.name)).toEqual(['Time', 'Value']);
    expect(frame.fields[0].type).toBe(FieldType.time);
    expect(frame.fields[1].type).toBe(FieldType.number);
  }

  it('returns undefined for a shape it cannot recognise as a prometheus body', () => {
    expect(prometheusResponseToDataFrames({ nope: true }, 'A')).toBeUndefined();
    expect(prometheusResponseToDataFrames(null, 'A')).toBeUndefined();
  });

  it('returns [] for a recognised body with an unsupported resultType', () => {
    expect(prometheusResponseToDataFrames({ resultType: 'string', result: ['1', 'hi'] }, 'A')).toEqual([]);
  });

  describe('scalar', () => {
    it('converts a single [time, value] sample into one Time/Value frame', () => {
      const frames = prometheusResponseToDataFrames({ resultType: 'scalar', result: ['1.5', '42'] }, 'A')!;

      expect(frames).toHaveLength(1);
      expectTimeValueFrame(frames[0]);
      expect(frames[0].refId).toBe('A');
      expect(frames[0].fields[0].values).toEqual([1500]); // seconds -> ms
      expect(frames[0].fields[1].values).toEqual([42]);
      // No metric -> no labels on the Value field.
      expect(frames[0].fields[1].labels).toBeUndefined();
    });
  });

  describe('vector', () => {
    it('produces one frame per series and extracts string labels onto the Value field', () => {
      const frames = prometheusResponseToDataFrames(
        {
          resultType: 'vector',
          result: [{ metric: { __name__: 'up', job: 'api', port: 9090 }, value: ['2', '7'] }],
        },
        'A'
      )!;

      expect(frames).toHaveLength(1);
      expectTimeValueFrame(frames[0]);
      expect(frames[0].fields[0].values).toEqual([2000]);
      expect(frames[0].fields[1].values).toEqual([7]);
      // Non-string label values (port: 9090) are dropped; string labels are kept.
      expect(frames[0].fields[1].labels).toEqual({ __name__: 'up', job: 'api' });
      // Frame name defaults to the __name__ label when present.
      expect(frames[0].name).toBe('up');
    });

    it('drops series whose sample is unparseable, keeping the rest', () => {
      const frames = prometheusResponseToDataFrames(
        {
          resultType: 'vector',
          result: [
            { metric: { job: 'good' }, value: ['1', '10'] },
            { metric: { job: 'bad' }, value: ['1', 'notanumber'] },
          ],
        },
        'A'
      )!;

      expect(frames).toHaveLength(1);
      expect(frames[0].fields[1].labels).toEqual({ job: 'good' });
      expect(frames[0].fields[1].values).toEqual([10]);
    });
  });

  describe('matrix', () => {
    it('yields one frame per series, each with an aligned Time (time) and Value (number) field', () => {
      const frames = prometheusResponseToDataFrames(
        {
          resultType: 'matrix',
          result: [
            {
              metric: { pod: 'a' },
              values: [
                ['0', '1'],
                ['1', '2'],
              ],
            },
            {
              metric: { pod: 'b' },
              values: [
                ['0', '3'],
                ['1', '4'],
                ['2', '5'],
              ],
            },
          ],
        },
        'A'
      )!;

      expect(frames).toHaveLength(2);

      expectTimeValueFrame(frames[0]);
      expect(frames[0].fields[0].values).toEqual([0, 1000]);
      expect(frames[0].fields[1].values).toEqual([1, 2]);
      expect(frames[0].fields[1].labels).toEqual({ pod: 'a' });

      expectTimeValueFrame(frames[1]);
      expect(frames[1].fields[0].values).toEqual([0, 1000, 2000]);
      expect(frames[1].fields[1].values).toEqual([3, 4, 5]);
      expect(frames[1].fields[1].labels).toEqual({ pod: 'b' });
    });

    it('keeps Inf/+Inf/-Inf samples but drops NaN and non-numeric samples', () => {
      const frames = prometheusResponseToDataFrames(
        {
          resultType: 'matrix',
          result: [
            {
              metric: {},
              values: [
                ['0', 'Inf'],
                ['1', '+Inf'],
                ['2', '-Inf'],
                ['3', 'NaN'],
                ['4', 'oops'],
                ['5', '5'],
              ],
            },
          ],
        },
        'A'
      )!;

      expect(frames).toHaveLength(1);
      // NaN/'oops' points are dropped entirely; the infinities are preserved.
      expect(frames[0].fields[0].values).toEqual([0, 1000, 2000, 5000]);
      expect(frames[0].fields[1].values).toEqual([Infinity, Infinity, -Infinity, 5]);
    });

    it('drops points whose timestamp is not finite', () => {
      const frames = prometheusResponseToDataFrames(
        {
          resultType: 'matrix',
          result: [
            {
              metric: {},
              values: [
                ['0', '1'],
                ['NaN', '2'],
                ['3', '3'],
              ],
            },
          ],
        },
        'A'
      )!;

      expect(frames).toHaveLength(1);
      expect(frames[0].fields[0].values).toEqual([0, 3000]);
      expect(frames[0].fields[1].values).toEqual([1, 3]);
    });
  });

  describe('nested response envelopes', () => {
    it('unwraps a single { data: { resultType, result } } envelope', () => {
      const frames = prometheusResponseToDataFrames({ data: { resultType: 'scalar', result: ['1', '9'] } }, 'A')!;

      expect(frames).toHaveLength(1);
      expect(frames[0].fields[1].values).toEqual([9]);
    });

    it('unwraps a doubly-nested { data: { data: { resultType, result } } } envelope', () => {
      const frames = prometheusResponseToDataFrames(
        {
          data: {
            data: {
              resultType: 'matrix',
              result: [
                {
                  metric: { series: 'x' },
                  values: [
                    ['0', '1'],
                    ['1', '2'],
                  ],
                },
              ],
            },
          },
        },
        'A'
      )!;

      expect(frames).toHaveLength(1);
      expect(frames[0].fields[0].values).toEqual([0, 1000]);
      expect(frames[0].fields[1].values).toEqual([1, 2]);
      expect(frames[0].fields[1].labels).toEqual({ series: 'x' });
    });
  });
});

import { of } from 'rxjs';

import { createDataFrame, type DataFrame, FieldType } from '@grafana/data';
import { type DataSourceSrv, getDataSourceSrv } from '@grafana/runtime';

import { readScalar, runInstantQueries } from './promQuery';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getDataSourceSrv: jest.fn(),
}));

const mockGetDataSourceSrv = jest.mocked(getDataSourceSrv);
const query = jest.fn();

function setDataSources(
  list: Array<{ uid: string; isDefault?: boolean; type?: string }> = [
    { uid: 'prom', isDefault: true, type: 'prometheus' },
  ]
) {
  // The mock only implements the two members the query helpers touch; DataSourceSrv is the
  // named contract those helpers depend on.
  const srv = { getList: () => list, get: async () => ({ query }) } as unknown as DataSourceSrv;
  mockGetDataSourceSrv.mockReturnValue(srv);
}

function numberFrame(refId: string, values: number[]): DataFrame {
  return createDataFrame({
    refId,
    fields: [{ name: 'Value', type: FieldType.number, values }],
  });
}

beforeEach(() => {
  query.mockReset();
  query.mockReturnValue(of({ data: [] }));
  setDataSources();
});

afterEach(() => jest.restoreAllMocks());

describe('readScalar', () => {
  it('returns the last finite value of the matching frame', () => {
    expect(readScalar([numberFrame('A', [1, 2, 3])], 'A')).toBe(3);
  });

  it('returns null when no frame matches the refId', () => {
    expect(readScalar([numberFrame('A', [1, 2, 3])], 'B')).toBeNull();
  });

  it('returns null when the matching frame is empty', () => {
    expect(readScalar([numberFrame('A', [])], 'A')).toBeNull();
  });

  it('returns null when the last value is not finite', () => {
    expect(readScalar([numberFrame('A', [1, Infinity])], 'A')).toBeNull();
  });
});

describe('runInstantQueries', () => {
  it('throws when no datasource of the requested type is configured', async () => {
    setDataSources([]);

    await expect(runInstantQueries('prometheus', { A: 'up' })).rejects.toThrow('No prometheus datasource configured');
    expect(query).not.toHaveBeenCalled();
  });

  it('sends an instant target and returns the parsed frames for a single refId', async () => {
    query.mockReturnValue(of({ data: { resultType: 'vector', result: [{ metric: {}, value: ['1', '42'] }] } }));

    const frames = await runInstantQueries('prometheus', { A: 'up' });

    const request = query.mock.calls[0][0];
    expect(request.targets).toHaveLength(1);
    expect(request.targets[0]).toMatchObject({ refId: 'A', expr: 'up', instant: true, range: false });

    expect(readScalar(frames, 'A')).toBe(42);
  });
});

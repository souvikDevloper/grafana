import { from, lastValueFrom } from 'rxjs';

import {
  CoreApp,
  type DataFrame,
  type DataSourceApi,
  type DataQuery,
  type DataQueryRequest,
  FieldType,
  generateUUID,
  getDefaultTimeRange,
  type IntervalValues,
  rangeUtil,
  type TimeRange,
} from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { isDataFrameResponse, prometheusResponseToDataFrames } from 'app/features/query/state/prometheusResponse';

// Datasources carry expr/instant/range on each target; model them on top of DataQuery so the
// request is fully typed without importing a plugin's query type.
interface PrometheusQueryTarget extends DataQuery {
  expr: string;
  instant: boolean;
  range: boolean;
}

export function readScalar(frames: DataFrame[], refId: string): number | null {
  const field = frames.find((f) => f.refId === refId)?.fields.find((f) => f.type === FieldType.number);
  const v = field && field.values.length ? field.values[field.values.length - 1] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function runInstantQueriesWithDataSource(
  ds: DataSourceApi,
  queries: Record<string, string>
): Promise<DataFrame[]> {
  const range = getDefaultTimeRange();
  const intervalInfo = rangeUtil.calculateInterval(range, 1);
  const targets: PrometheusQueryTarget[] = Object.entries(queries).map(([refId, expr]) => ({
    refId,
    expr,
    instant: true,
    range: false,
  }));
  const result = await lastValueFrom(from(ds.query(createPrometheusQueryRequest(targets, range, intervalInfo))));

  if (isDataFrameResponse(result) || targets.length <= 1) {
    return queryResultToFrames(result, targets[0]?.refId ?? 'A');
  }

  // Native Prometheus responses do not carry Grafana refIds, so rerun individually only for that shape.
  const framesByTarget = await Promise.all(
    targets.map(async (target) => {
      const singleResult = await lastValueFrom(
        from(ds.query(createPrometheusQueryRequest([target], range, intervalInfo)))
      );
      return queryResultToFrames(singleResult, target.refId);
    })
  );

  return framesByTarget.flat();
}

function createPrometheusQueryRequest(
  targets: PrometheusQueryTarget[],
  range: TimeRange,
  intervalInfo: IntervalValues
): DataQueryRequest<PrometheusQueryTarget> {
  return {
    requestId: `home-overview-${generateUUID()}`,
    interval: intervalInfo.interval,
    intervalMs: intervalInfo.intervalMs,
    range,
    scopedVars: {},
    timezone: 'UTC',
    app: CoreApp.Unknown,
    startTime: Date.now(),
    targets,
  };
}

function queryResultToFrames(result: unknown, refId: string): DataFrame[] {
  return isDataFrameResponse(result) ? result.data : (prometheusResponseToDataFrames(result, refId) ?? []);
}

/**
 * Run a batch of instant queries against the default datasource of `dsType` (else the first) and
 * return the response frames. Throws (handled as a retryable error by callers) when none is
 * configured. The overview cards read single-value scalars off the result via {@link readScalar}.
 */
export async function runInstantQueries(dsType: string, queries: Record<string, string>): Promise<DataFrame[]> {
  const matches = getDataSourceSrv().getList({ type: dsType });
  const settings = matches.find((d) => d.isDefault) ?? matches[0];
  if (!settings) {
    throw new Error(`No ${dsType} datasource configured`);
  }
  const ds = await getDataSourceSrv().get(settings.uid);
  return runInstantQueriesWithDataSource(ds, queries);
}

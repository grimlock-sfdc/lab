import type { ManifestWork, StatusFeedbackResult } from '../api/manifestWorkService';

/**
 * Status color for node borders. Maps derived status to a hex color.
 */
export const borderColor = (status: string) => {
  if (status === 'Applied' || status === 'Available') return '#4caf50';
  if (status === 'Degraded' || status === 'Progressing' || status === 'Pending') return '#ff9800';
  if (status === 'Failed') return '#f44336';
  return '#9e9e9e';
};

/**
 * MUI Chip color for status badges.
 */
export const chipColor = (status: string): 'success' | 'warning' | 'error' | 'default' => {
  if (status === 'Applied' || status === 'Available') return 'success';
  if (status === 'Degraded' || status === 'Progressing' || status === 'Pending') return 'warning';
  if (status === 'Failed') return 'error';
  return 'default';
};

/**
 * Derive ManifestWork status from its conditions.
 * If any child resource reports degraded feedback, the MW is Degraded.
 */
export const deriveMWStatus = (mw: ManifestWork): string => {
  const applied = mw.conditions?.find(c => c.type === 'Applied');
  if (applied?.status === 'False') return 'Failed';

  // Check if any resource has feedback indicating degraded health
  const hasDegraded = mw.resourceStatus?.manifests?.some(
    m => isFeedbackDegraded(m.statusFeedback),
  );

  if (applied?.status === 'True') return hasDegraded ? 'Degraded' : 'Applied';

  const available = mw.conditions?.find(c => c.type === 'Available');
  if (available?.status === 'True') return hasDegraded ? 'Degraded' : 'Available';

  return 'Pending';
};

/**
 * Derive resource status from OCM conditions and StatusFeedback.
 *
 * OCM conditions reflect whether the manifest was applied to the spoke cluster.
 * StatusFeedback provides deeper health data synced from the workload itself.
 * When StatusFeedback reports "Available" = "False", the resource is Applied
 * but degraded — the manifest was applied but the workload isn't healthy.
 */
export const deriveResStatus = (
  conditions: { type: string; status: string }[],
  feedback?: StatusFeedbackResult,
): string => {
  if (!conditions?.length) return 'Pending';
  const applied = conditions.find(c => c.type === 'Applied');
  if (applied?.status === 'False') return 'Failed';

  if (applied?.status === 'True') {
    return isFeedbackDegraded(feedback) ? 'Degraded' : 'Applied';
  }

  return 'Pending';
};

/**
 * Derive MWRS status from its OCM conditions and child ManifestWorks' feedback.
 *
 * OCM's MWRS conditions only reflect whether manifests were applied.
 * StatusFeedback from child ManifestWorks reveals actual workload health.
 */
export const deriveMWRSStatus = (
  mwrs: { conditions?: { type: string; status: string; reason?: string }[] },
  childManifestWorks?: ManifestWork[],
): string => {
  const cond = mwrs.conditions?.find(c => c.type === 'ManifestworkApplied');
  if (!cond || cond.status === 'False') return 'Failed';
  if (cond.reason === 'Processing') return 'Progressing';

  if (cond.status === 'True') {
    const anyDegraded = childManifestWorks?.some(mw => deriveMWStatus(mw) === 'Degraded');
    return anyDegraded ? 'Degraded' : 'Applied';
  }

  return 'Pending';
};

/**
 * OCM label used to identify which MWRS created a ManifestWork.
 */
const MWRS_LABEL = 'work.open-cluster-management.io/manifestworkreplicaset';

/**
 * Build a lookup from "namespace/name" MWRS key to its child ManifestWorks.
 */
export function buildMWRSChildMap(manifestWorks: ManifestWork[]): Map<string, ManifestWork[]> {
  const map = new Map<string, ManifestWork[]>();
  for (const mw of manifestWorks) {
    const labelValue = mw.labels?.[MWRS_LABEL];
    if (!labelValue) continue;
    // Label format is "namespace.name" — convert to "namespace/name" for lookup
    const dotIdx = labelValue.indexOf('.');
    if (dotIdx === -1) continue;
    const key = `${labelValue.substring(0, dotIdx)}/${labelValue.substring(dotIdx + 1)}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(mw);
    } else {
      map.set(key, [mw]);
    }
  }
  return map;
}

/**
 * Extract a human-readable degraded reason from StatusFeedback.
 * Returns the most informative message available, or undefined if not degraded.
 */
export function getDegradedReason(feedback?: StatusFeedbackResult): string | undefined {
  if (!isFeedbackDegraded(feedback)) return undefined;
  const values = feedback!.values!;

  // Prefer the most specific message available (JSONPaths pattern)
  const progressingMsg = values.find(v => v.name === 'ProgressingMessage')?.fieldValue.string;
  const availableMsg = values.find(v => v.name === 'AvailableMessage')?.fieldValue.string;
  const progressingReason = values.find(v => v.name === 'ProgressingReason')?.fieldValue.string;

  if (progressingMsg || availableMsg || progressingReason) {
    return progressingMsg || availableMsg || progressingReason;
  }

  // WellKnownStatus pattern: build message from replica counts
  const replicas = values.find(v => v.name === 'Replicas')?.fieldValue.integer ?? 0;
  const ready = values.find(v => v.name === 'ReadyReplicas')?.fieldValue.integer ?? 0;
  if (ready < replicas) {
    return `${ready}/${replicas} replicas ready`;
  }

  return 'Workload is not available';
}

/**
 * Collect all degraded reasons across a ManifestWork's resources.
 * Returns an array of { resource, reason } objects.
 */
export function getMWDegradedReasons(mw: ManifestWork): { resource: string; reason: string }[] {
  const results: { resource: string; reason: string }[] = [];
  for (const m of mw.resourceStatus?.manifests ?? []) {
    const reason = getDegradedReason(m.statusFeedback);
    if (reason) {
      const kind = m.resourceMeta.kind ?? 'Resource';
      const name = m.resourceMeta.name ?? '';
      results.push({ resource: `${kind}/${name}`, reason });
    }
  }
  return results;
}

/**
 * Check whether StatusFeedback values indicate a degraded workload.
 *
 * Supports two patterns:
 * - JSONPaths: checks for an "Available" feedback value of "False"
 * - WellKnownStatus: checks if ReadyReplicas < Replicas (replica count mismatch)
 */
function isFeedbackDegraded(feedback?: StatusFeedbackResult): boolean {
  if (!feedback?.values?.length) return false;

  // JSONPaths pattern: explicit Available condition
  const available = feedback.values.find(v => v.name === 'Available');
  if (available?.fieldValue.type === 'String' && available.fieldValue.string === 'False') {
    return true;
  }

  // WellKnownStatus pattern: replica count mismatch
  const replicas = feedback.values.find(v => v.name === 'Replicas');
  const readyReplicas = feedback.values.find(v => v.name === 'ReadyReplicas');
  if (replicas?.fieldValue.type === 'Integer' && replicas.fieldValue.integer != null) {
    const ready = readyReplicas?.fieldValue.type === 'Integer' ? (readyReplicas.fieldValue.integer ?? 0) : 0;
    if (ready < replicas.fieldValue.integer) return true;
  }

  return false;
}

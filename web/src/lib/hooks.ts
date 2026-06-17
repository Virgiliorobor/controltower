// react-query data hooks. Justification (per the dispatch's "keep state simple — your call, justify briefly"):
// the map, library, step-detail and contacts all read the SAME registry entities, and every editor mutation
// (publish, confirm, attach-doc, edit) must invalidate the right read so the node's RAG/confidence updates
// immediately (FLOW 3 step 3). react-query gives that cache + invalidation in one place; hand-rolled fetch
// hooks would re-implement caching/invalidation per view. No global store is needed beyond auth + i18n.

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { adminApi, aiApi, partyApi, processApi, stepApi } from './endpoints';
import type {
  AdminUser,
  AppSettings,
  FreshnessReport,
  Process,
  ProcessGraph,
  ProcessStatus,
  ResponsibleParty,
  StepDetail,
} from './types';
import { ApiRequestError } from './api';

export const qk = {
  processes: (filters?: { status?: ProcessStatus; has_unowned?: boolean }) => ['processes', filters ?? {}] as const,
  process: (id: string) => ['process', id] as const,
  map: (id: string) => ['map', id] as const,
  step: (id: string) => ['step', id] as const,
  parties: () => ['parties'] as const,
  freshness: (id: string) => ['freshness', id] as const,
  users: () => ['users'] as const,
  settings: () => ['settings'] as const,
};

export function useProcesses(filters: { status?: ProcessStatus; has_unowned?: boolean } = {}): UseQueryResult<Process[]> {
  return useQuery({
    queryKey: qk.processes(filters),
    queryFn: async () => (await processApi.list(filters)).processes,
  });
}

export function useProcessMap(id: string | undefined): UseQueryResult<ProcessGraph> {
  return useQuery({
    queryKey: qk.map(id ?? ''),
    queryFn: async () => processApi.map(id as string),
    enabled: Boolean(id),
  });
}

export function useStepDetail(id: string | undefined): UseQueryResult<StepDetail> {
  return useQuery({
    queryKey: qk.step(id ?? ''),
    queryFn: async () => (await stepApi.get(id as string)).step,
    enabled: Boolean(id),
  });
}

export function useParties(): UseQueryResult<ResponsibleParty[]> {
  return useQuery({ queryKey: qk.parties(), queryFn: async () => (await partyApi.list()).parties });
}

export function useFreshness(id: string | undefined): UseQueryResult<FreshnessReport | null> {
  return useQuery({
    queryKey: qk.freshness(id ?? ''),
    queryFn: async () => {
      try {
        return (await aiApi.freshness(id as string)).report;
      } catch (error) {
        // 404 = no report scanned yet → null (not an error state).
        if (error instanceof ApiRequestError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: Boolean(id),
    retry: false,
  });
}

export function useUsers(enabled: boolean): UseQueryResult<AdminUser[]> {
  return useQuery({ queryKey: qk.users(), queryFn: async () => (await adminApi.listUsers()).users, enabled });
}

export function useSettings(enabled: boolean): UseQueryResult<AppSettings> {
  return useQuery({ queryKey: qk.settings(), queryFn: async () => (await adminApi.getSettings()).settings, enabled });
}

// Invalidate the reads a step/process write can affect (RAG + confidence are denormalized server-side).
export function useInvalidators(): {
  invalidateProcess: (processId: string) => void;
  invalidateStep: (stepId: string) => void;
  invalidateAll: () => void;
} {
  const qc = useQueryClient();
  return {
    invalidateProcess: (processId: string) => {
      void qc.invalidateQueries({ queryKey: qk.map(processId) });
      void qc.invalidateQueries({ queryKey: ['processes'] });
      void qc.invalidateQueries({ queryKey: qk.process(processId) });
    },
    invalidateStep: (stepId: string) => {
      void qc.invalidateQueries({ queryKey: qk.step(stepId) });
    },
    invalidateAll: () => {
      void qc.invalidateQueries();
    },
  };
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) return error.body?.message ?? error.message ?? fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

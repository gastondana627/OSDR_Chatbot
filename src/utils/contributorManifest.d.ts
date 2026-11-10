export const AWG_SUBGROUPS: string[];

export interface ParsedOsdrStudyIds {
  validIds: string[];
  invalidTokens: string[];
}

export interface ContributorSubmissionInput {
  contributorName?: string;
  forumHandle?: string;
  awgSubgroup?: string;
  affiliation?: string;
  projectTitle?: string;
  abstract?: string;
  liveDemoUrl?: string;
  repositoryOrPaperUrl?: string;
  targetStudyIds?: string;
}

export interface ContributorManifest {
  schemaVersion: string;
  manifestType: string;
  submittedAt: string;
  contributor: {
    name: string;
    handle: string | null;
    awgSubgroup: string;
    affiliation: string | null;
  };
  project: {
    title: string;
    abstract: string;
    liveDemoUrl: string | null;
    repositoryOrPaperUrl: string | null;
    status: string;
  };
  osdrIntegration: {
    targetStudyIds: string[];
    upstreamDiscoveryHub: string;
    contractHandshakeVersion: string;
    includesRetinalFrozenPanelPolicy: boolean;
    frozenPanelReference?: {
      referenceAccession: string;
      discoveryPanelSize: number;
      discoveryThreshold: string;
    };
    provenanceGuardrails: string[];
  };
}

export function parseTargetOsdrStudyIds(rawInput: string): ParsedOsdrStudyIds;
export function normalizeForumHandle(rawHandle: string): string;
export function buildContributorManifest(formInput?: ContributorSubmissionInput): ContributorManifest;
export function formatGitHubContributionBlock(manifest: ContributorManifest): string;
export function formatForumAnnouncementText(manifest: ContributorManifest): string;
export function copyTextSafely(text: string): Promise<boolean>;
export function downloadJsonFile(filename: string, data: unknown): boolean;
export function loadSavedContributorSubmissions(): Array<{
  id: string;
  savedAt: string;
  manifest: ContributorManifest;
}>;
export function saveContributorSubmission(
  manifest: ContributorManifest
): Array<{ id: string; savedAt: string; manifest: ContributorManifest }>;
export function removeContributorSubmission(
  entryId: string
): Array<{ id: string; savedAt: string; manifest: ContributorManifest }>;

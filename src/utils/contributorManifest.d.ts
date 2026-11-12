export const AWG_SUBGROUPS: string[];

export interface FeaturedCommunityMetadata {
  id: string;
  title: string;
  author: string;
  subgroup?: string;
  appUrl: string;
  repoUrl: string;
  domain: string;
  tags: string[];
  disclaimer: string;
}

export const FEATURED_COMMUNITY_MANIFESTS: Record<string, FeaturedCommunityMetadata>;

export interface CommunityModelManifestDoc {
  schemaVersion: string;
  manifestType: string;
  generatedAt: string;
  id: string;
  title: string;
  author: string;
  creatorHandle: string;
  subgroup?: string;
  status: string;
  domain: string;
  tags: string[];
  appUrl: string;
  repoUrl: string;
  description: string;
  datasetScope: string[];
  provenanceGuardrails: string[];
  disclaimer: string;
  upstreamHub: {
    name: string;
    route: string;
    apiEndpoint: string;
    repository: string;
  };
  citation: {
    preferredCitation: string;
    attributionNotice: string;
  };
}

export function buildFeaturedModelManifest(entry?: Record<string, unknown>): CommunityModelManifestDoc;

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


export type UserRole = "admin" | "member";

export type User = {
  id: string;
  username: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type GenerationProgress = {
  phase:
    | "queued"
    | "loading_references"
    | "references_ready"
    | "submitting"
    | "requesting"
    | "provider_returned"
    | "downloading"
    | "saving"
    | "saved"
    | "succeeded"
    | "failed"
    | "canceled";
  current: number;
  total: number;
  percent: number;
  message: string;
  referenceCount?: number;
  requestStartedAt?: string;
  slowNotifiedAt?: string;
  updatedAt: string;
};

export type GenerationJob = {
  id: string;
  user_id: string;
  username?: string;
  model: string;
  prompt: string;
  size: string;
  count: number;
  status: GenerationStatus;
  provider: string;
  provider_request_id: string | null;
  error_message: string | null;
  request_metadata: Record<string, unknown>;
  response_metadata: Record<string, unknown> | null;
  provider_key_label?: string | null;
  provider_key_source?: string | null;
  progress?: GenerationProgress | null;
  tags?: string[];
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
};

export type GeneratedImage = {
  id: string;
  job_id: string;
  parent_image_id: string | null;
  local_path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  byte_size: number;
  checksum: string;
  sort_order: number;
  tags?: string[];
  is_favorite?: boolean;
  favorite_created_at?: string | null;
  created_at: string;
};

export type ImageVersionNode = GeneratedImage & {
  depth: number;
  is_current: boolean;
  job_prompt: string;
  job_model: string;
  job_size: string;
  job_status: GenerationStatus;
  job_created_at: string;
};

export type ReferenceImage = {
  id: string;
  user_id: string;
  local_path: string;
  mime_type: string;
  byte_size: number;
  checksum: string;
  created_at: string;
};

export type PromptTemplate = {
  id: string;
  title: string;
  category: string;
  content: string;
  source_key: string | null;
  source_name: string | null;
  source_url: string | null;
  source_license: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type JobWithImages = GenerationJob & {
  images: GeneratedImage[];
};

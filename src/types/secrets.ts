export interface Secret {
  id: string;
  value: string;
  label: string;
  active: boolean;
}

export type SecretMap = Record<string, Secret[] | null>;

export interface RenameSecretRequest {
  key: string;
  id: string;
  label: string;
}

export interface CreateSecretRequest {
  key: string;
  value: string;
  label: string;
}

export interface DeleteSecretRequest {
  key: string;
  id: string;
}

export interface RotateSecretRequest {
  key: string;
  id: string;
}

export interface SecretCreatedResponse {
  id: string;
}

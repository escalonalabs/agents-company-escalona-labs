export type {
  Company,
  Objective,
  WorkItem,
  Run,
  DomainEvent,
} from '@escalonalabs/domain';

export interface ApiClientConfig {
  baseUrl: string;
  withCredentials?: boolean;
}

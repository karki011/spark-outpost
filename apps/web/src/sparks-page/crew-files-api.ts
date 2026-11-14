import { z } from 'zod';
import {
  crewFileSchema,
  sparkFolderSchema,
  type CrewFile,
  type SaveCrewFile,
  type SparkFolder,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

const folderRoute = (sparkId: string) => `/teammates/${sparkId}/folder`;
const filesRoute = (sparkId: string) => `/teammates/${sparkId}/files`;
const fileRoute = (sparkId: string, path: string) =>
  `${filesRoute(sparkId)}?path=${encodeURIComponent(path)}`;

export const crewFileKeys = {
  folders: ['crew-folder'] as const,
  folder: (sparkId: string) => ['crew-folder', sparkId] as const,
  files: (sparkId: string) => ['crew-file', sparkId] as const,
  file: (sparkId: string, path: string) => ['crew-file', sparkId, path] as const,
};

export const crewFilesApi = {
  folder: (sparkId: string): Promise<SparkFolder> =>
    request(sparkFolderSchema, folderRoute(sparkId)),
  read: (sparkId: string, path: string): Promise<CrewFile> =>
    request(crewFileSchema, fileRoute(sparkId, path)),
  save: (sparkId: string, file: SaveCrewFile): Promise<CrewFile> =>
    request(crewFileSchema, filesRoute(sparkId), { method: 'PUT', body: JSON.stringify(file) }),
  remove: (sparkId: string, path: string): Promise<null> =>
    request(z.null(), fileRoute(sparkId, path), { method: 'DELETE' }),
};

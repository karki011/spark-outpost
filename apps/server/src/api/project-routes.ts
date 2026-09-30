import { Router, type Request } from 'express';
import {
  ATTACHMENT_TEXT_MAX_BYTES,
  attachProjectFileRequestSchema,
  conversationOrderRequestSchema,
  createProjectRequestSchema,
  projectOrderRequestSchema,
  removedProjectSchema,
  updateProjectRequestSchema,
  type ProjectFileContent,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { saveAttachment } from '../persistence/attachments.ts';
import { AttachmentError, UNSUPPORTED_ATTACHMENT } from '../persistence/attachment-content.ts';
import { listFolders } from '../projects/folders.ts';
import { currentBranch } from '../projects/git.ts';
import { listProjectFiles } from '../projects/project-files.ts';
import { projectPolicy, readProjectFile } from '../projects/project-fs.ts';
import { PathRefusedError, type PathPolicy, type RefusalReason } from '../projects/path-policy.ts';
import { removeProject, restoreProject } from '../projects/project-removal.ts';
import {
  createProject,
  getProject,
  listProjects,
  orderProjectChats,
  orderProjects,
  updateProject,
} from '../projects/projects.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

export interface ProjectRouteDeps {
  db: Db;
  workspaceId: string;
}

const TOO_LARGE = `That file is too large. Text files must be ${ATTACHMENT_TEXT_MAX_BYTES / 1024} KB or smaller.`;

const REFUSAL_MESSAGES: Record<RefusalReason, string> = {
  'not absolute': 'That file is outside the project folder.',
  'outside the project': 'That file is outside the project folder.',
  'secret file': "Spark Outpost won't attach secret files like .env.",
  'inside .git': "Spark Outpost won't change files inside .git.",
  'not a file': 'That path is not a file.',
  'larger than 1 MB': TOO_LARGE,
};

function queryText(req: Request, name: string): string {
  const value = req.query[name];
  return typeof value === 'string' ? value : '';
}

async function openProject(db: Db, workspaceId: string, id: string): Promise<PathPolicy> {
  const project = await getProject(db, workspaceId, id);
  try {
    return await projectPolicy([project.rootPath]);
  } catch {
    throw new BadRequestError(`The folder ${project.rootPath} is missing. Link the project again.`);
  }
}

async function readForAttachment(policy: PathPolicy, requested: string) {
  try {
    return await readProjectFile(policy, requested);
  } catch (error) {
    if (error instanceof PathRefusedError) {
      throw new BadRequestError(REFUSAL_MESSAGES[error.reason]);
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new BadRequestError("That file doesn't exist in the project.");
    }
    throw error;
  }
}

export function projectRoutes({ db, workspaceId }: ProjectRouteDeps): Router {
  const router = Router();

  router.get('/folders', async (req, res) => {
    res.json(await listFolders(queryText(req, 'path') || undefined));
  });

  router.get('/projects', async (_req, res) => {
    res.json(await listProjects(db, workspaceId));
  });

  router.post('/projects', async (req, res) => {
    const { rootPath } = parseBody(createProjectRequestSchema, req);
    const { project, created } = await createProject(db, workspaceId, rootPath);
    res.status(created ? 201 : 200).json(project);
  });

  router.put('/projects/order', async (req, res) => {
    const { projectIds } = parseBody(projectOrderRequestSchema, req);
    await orderProjects(db, workspaceId, projectIds);
    res.status(204).end();
  });

  router.put('/projects/:id/chat-order', async (req, res) => {
    const { conversationIds } = parseBody(conversationOrderRequestSchema, req);
    await orderProjectChats(db, workspaceId, paramId(req), conversationIds);
    res.status(204).end();
  });

  router.post('/projects/restore', async (req, res) => {
    const removed = parseBody(removedProjectSchema, req);
    res.status(201).json(await restoreProject(db, workspaceId, removed));
  });

  router.patch('/projects/:id', async (req, res) => {
    const change = parseBody(updateProjectRequestSchema, req);
    res.json(await updateProject(db, workspaceId, paramId(req), change));
  });

  router.delete('/projects/:id', async (req, res) => {
    res.json(await removeProject(db, workspaceId, paramId(req)));
  });

  router.get('/projects/:id/git', async (req, res) => {
    const policy = await openProject(db, workspaceId, paramId(req));
    res.json({ branch: await currentBranch(policy.roots[0]!.path) });
  });

  router.get('/projects/:id/files', async (req, res) => {
    const policy = await openProject(db, workspaceId, paramId(req));
    res.json(await listProjectFiles(policy.roots[0]!, queryText(req, 'query')));
  });

  router.get('/projects/:id/file', async (req, res) => {
    const requested = queryText(req, 'path');
    if (!requested) throw new BadRequestError('Name a file to open.');
    const policy = await openProject(db, workspaceId, paramId(req));
    const file = await readForAttachment(policy, requested);
    if (file.data.includes(0)) {
      throw new BadRequestError("That file isn't text, so it can't be shown here.");
    }
    const content: ProjectFileContent = {
      path: file.relative,
      text: file.data.toString('utf8'),
      bytes: file.data.length,
    };
    res.json(content);
  });

  router.post('/projects/:id/attachments', async (req, res) => {
    const { path } = parseBody(attachProjectFileRequestSchema, req);
    const policy = await openProject(db, workspaceId, paramId(req));
    const file = await readForAttachment(policy, path);
    if (file.data.length > ATTACHMENT_TEXT_MAX_BYTES) throw new BadRequestError(TOO_LARGE);
    try {
      const attachment = await saveAttachment(db, workspaceId, {
        name: file.relative,
        mediaType: 'text/plain',
        data: file.data,
        sourcePath: file.relative,
      });
      res.status(201).json(attachment);
    } catch (error) {
      if (error instanceof AttachmentError && error.message === UNSUPPORTED_ATTACHMENT) {
        throw new BadRequestError('Only text files can be attached from a project folder.');
      }
      throw error;
    }
  });

  return router;
}

import { contextBridge } from 'electron';
import { guardMediaInPage } from './media-guard-page.ts';

contextBridge.executeInMainWorld({ func: guardMediaInPage });

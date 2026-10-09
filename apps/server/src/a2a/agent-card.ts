import type { AgentCard } from '@a2a-js/sdk';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';
import type { ChatFacts } from '../persistence/outpost-tasks.ts';

export type CardFacts = ChatFacts;

export const A2A_MOUNT_PATH = '/api/a2a';
export const A2A_BINDING = 'JSONRPC';
export const A2A_VERSION = '1.0';
export const TEXT_MODE = 'text/plain';
const TOKEN_SCHEME = 'launchToken';
const CARD_VERSION = '1';

export function a2aBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}${A2A_MOUNT_PATH}`;
}

export function chatEndpoint(baseUrl: string, chatId: string): string {
  return `${baseUrl}/chats/${chatId}`;
}

function cardName(chat: CardFacts): string {
  return chat.handle === null ? chat.title : `@${chat.handle} · ${chat.title}`;
}

function cardDescription(chat: CardFacts): string {
  const place =
    chat.outpostName === null
      ? 'A Spark chat on this Mac.'
      : `A Spark chat in the outpost "${chat.outpostName}" on this Mac.`;
  return `${place} It takes one text request per task, works on it under its own settings and answers in text. A task that needs input is answered by the user in Spark, not by a further message.`;
}

function skillDescription(chat: CardFacts): string {
  if (chat.projects.length === 0) return 'Answers a request in a chat with no linked project.';
  return `Answers a request about, or makes a change in, ${chat.projects.join(', ')}.`;
}

export function agentCard(chat: CardFacts, baseUrl: string): AgentCard {
  return {
    name: cardName(chat),
    description: cardDescription(chat),
    version: CARD_VERSION,
    supportedInterfaces: [
      {
        url: chatEndpoint(baseUrl, chat.conversationId),
        protocolBinding: A2A_BINDING,
        protocolVersion: A2A_VERSION,
        tenant: '',
      },
    ],
    provider: undefined,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [],
    },
    securitySchemes: {
      [TOKEN_SCHEME]: {
        scheme: {
          $case: 'apiKeySecurityScheme',
          value: {
            description: 'The launch token of the Spark app running on this Mac.',
            location: 'header',
            name: API_TOKEN_HEADER,
          },
        },
      },
    },
    securityRequirements: [{ schemes: { [TOKEN_SCHEME]: { list: [] } } }],
    defaultInputModes: [TEXT_MODE],
    defaultOutputModes: [TEXT_MODE],
    skills: [
      {
        id: 'request',
        name: 'Take a request',
        description: skillDescription(chat),
        tags: ['outpost', ...chat.projects],
        examples: [],
        inputModes: [TEXT_MODE],
        outputModes: [TEXT_MODE],
        securityRequirements: [],
      },
    ],
    signatures: [],
  };
}

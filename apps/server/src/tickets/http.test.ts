import { describe, expect, it } from 'vitest';
import { failure } from './http.ts';

describe('ticket source failures', () => {
  it('names each field Jira refused when its errors come as a map', () => {
    const error = failure('Jira', 'creating the ticket', {
      status: 400,
      data: {
        errorMessages: [],
        errors: {
          parent: 'Could not find issue by id or key: WEB-9',
          customfield_10001: 'The Team must be a string',
        },
      },
      retryAfter: null,
    });
    expect(error.message).toBe(
      'Jira responded with 400 while creating the ticket: parent: Could not find issue by id or key: WEB-9; customfield_10001: The Team must be a string',
    );
  });

  it('keeps a general message beside the field errors', () => {
    const error = failure('Jira', 'changing WEB-1', {
      status: 400,
      data: { errorMessages: ['Bad request.'], errors: { issuetype: 'Not allowed.' } },
      retryAfter: null,
    });
    expect(error.message).toContain(': Bad request.; issuetype: Not allowed.');
  });

  it('adds what Jira said to a permission refusal, and stays short without it', () => {
    const said = failure('Jira', 'creating the ticket', {
      status: 403,
      data: { errorMessages: ['You do not have permission to create issues in this project.'] },
      retryAfter: null,
    });
    expect(said.message).toBe(
      'Jira denied access while creating the ticket (403). Check that your account can see this ticket and has the permission it needs. Jira said: You do not have permission to create issues in this project.',
    );
    const bare = failure('Jira', 'reading WEB-1', { status: 404, data: null, retryAfter: null });
    expect(bare.message).toBe(
      'Jira denied access while reading WEB-1 (404). Check that your account can see this ticket.',
    );
  });
});

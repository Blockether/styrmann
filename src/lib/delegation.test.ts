import { beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '@/lib/db/test-helpers';

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

vi.mock('@/lib/llm', () => ({
  isLlmAvailable: vi.fn(() => false),
  llmJsonInfer: vi.fn(async () => null),
}));

import { getDb } from '@/lib/db';
import { isLlmAvailable, llmJsonInfer } from '@/lib/llm';
import { delegateOrgTicket } from '@/lib/delegation';

describe('delegateOrgTicket', () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestDb();
    vi.mocked(getDb).mockReturnValue(testDb);
  });

  function seedOrgWorkspaceAndTicket(overrides?: { ticketStatus?: string }) {
    const orgId = uuidv4();
    const workspaceId = uuidv4();
    const ticketId = uuidv4();

    testDb.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(orgId, 'Test Org', `test-org-${orgId.slice(0, 8)}`);
    testDb.prepare('INSERT INTO workspaces (id, name, slug, organization_id, is_internal) VALUES (?, ?, ?, ?, 0)').run(
      workspaceId,
      'Customer Workspace',
      `customer-ws-${workspaceId.slice(0, 8)}`,
      orgId,
    );
    testDb.prepare(
      'INSERT INTO org_tickets (id, organization_id, title, description, status, priority, ticket_type, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      ticketId,
      orgId,
      'Add full-text search',
      'Users need to search by keywords in all records',
      overrides?.ticketStatus || 'open',
      'high',
      'feature',
      '[]',
    );

    return { orgId, workspaceId, ticketId };
  }

  it('creates task, criteria, link, and updates ticket status when LLM is unavailable', async () => {
    const { ticketId, workspaceId } = seedOrgWorkspaceAndTicket();
    vi.mocked(isLlmAvailable).mockReturnValue(false);

    const result = await delegateOrgTicket(ticketId);

    expect(result.success).toBe(true);
    expect(result.llm_used).toBe(false);
    expect(result.task_ids.length).toBe(1);

    const createdTask = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get(result.task_ids[0]) as { workspace_id: string; org_ticket_id: string } | undefined;
    expect(createdTask).toBeDefined();
    expect(createdTask?.workspace_id).toBe(workspaceId);
    expect(createdTask?.org_ticket_id).toBe(ticketId);

    const delegatedTicket = testDb.prepare('SELECT status FROM org_tickets WHERE id = ?').get(ticketId) as { status: string };
    expect(delegatedTicket.status).toBe('delegated');

    const criteriaCount = testDb.prepare('SELECT COUNT(*) as count FROM task_acceptance_criteria WHERE task_id = ?').get(result.task_ids[0]) as { count: number };
    expect(criteriaCount.count).toBeGreaterThan(0);

    const link = testDb.prepare(
      "SELECT * FROM entity_links WHERE from_entity_type = 'org_ticket' AND from_entity_id = ? AND to_entity_type = 'task' AND to_entity_id = ? AND link_type = 'delegates_to'",
    ).get(ticketId, result.task_ids[0]);
    expect(link).toBeDefined();

    const activityCount = testDb.prepare('SELECT COUNT(*) as count FROM task_activities WHERE task_id = ?').get(result.task_ids[0]) as { count: number };
    expect(activityCount.count).toBeGreaterThan(0);
  });

  it('uses LLM plan when available and valid', async () => {
    const { ticketId, workspaceId } = seedOrgWorkspaceAndTicket();
    vi.mocked(isLlmAvailable).mockReturnValue(true);
    vi.mocked(llmJsonInfer).mockResolvedValue({
      tasks: [
        {
          workspace_id: workspaceId,
          title: 'Implement search index + query API',
          description: 'Build indexing and API query endpoint for search',
          task_type: 'feature',
          priority: 'urgent',
          effort: 4,
          impact: 5,
          acceptance_criteria: ['Search returns relevant results', 'Queries complete in <300ms for baseline dataset'],
        },
      ],
    });

    const result = await delegateOrgTicket(ticketId);

    expect(result.success).toBe(true);
    expect(result.llm_used).toBe(true);
    expect(result.task_ids.length).toBe(1);

    const createdTask = testDb.prepare('SELECT title, priority FROM tasks WHERE id = ?').get(result.task_ids[0]) as { title: string; priority: string };
    expect(createdTask.title).toBe('Implement search index + query API');
    expect(createdTask.priority).toBe('urgent');
  });

  it('returns error for non-existent ticket', async () => {
    const result = await delegateOrgTicket(uuidv4());
    expect(result.success).toBe(false);
    expect(result.error).toBe('Org ticket not found');
  });

  it('prevents double delegation (race condition)', async () => {
    const { ticketId } = seedOrgWorkspaceAndTicket();
    vi.mocked(isLlmAvailable).mockReturnValue(false);

    const result1 = await delegateOrgTicket(ticketId);
    expect(result1.success).toBe(true);

    const result2 = await delegateOrgTicket(ticketId);
    expect(result2.success).toBe(false);
    expect(result2.error).toMatch(/already delegated/i);
  });

  it('returns error when ticket is already delegated', async () => {
    const { ticketId } = seedOrgWorkspaceAndTicket({ ticketStatus: 'delegated' });
    const result = await delegateOrgTicket(ticketId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already delegated/i);
  });
});

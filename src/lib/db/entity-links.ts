import type Database from 'better-sqlite3';

export const MAX_LINK_DEPTH = 10;

export interface LinkedEntity {
  entity_id: string;
  entity_type: string;
  distance: number;
  link_type: string;
}

/**
 * Get all entities connected to the given entity within MAX_LINK_DEPTH hops.
 * Uses a recursive CTE with depth limit to prevent infinite loops.
 */
export function getConnectedEntities(
  db: Database.Database,
  entityId: string,
  maxDepth: number = MAX_LINK_DEPTH
): LinkedEntity[] {
  const result = db.prepare(`
    WITH RECURSIVE connected(entity_id, entity_type, distance, link_type) AS (
      -- Direct outgoing links from our entity
      SELECT to_entity_id, to_entity_type, 1, link_type
      FROM entity_links
      WHERE from_entity_id = ?
      
      UNION ALL
      
      -- Recursive step: follow outgoing links from already-found entities
      SELECT el.to_entity_id, el.to_entity_type, c.distance + 1, el.link_type
      FROM entity_links el
      INNER JOIN connected c ON el.from_entity_id = c.entity_id
      WHERE c.distance < ?
        AND el.to_entity_id != ?  -- Don't loop back to the start
    )
    SELECT DISTINCT entity_id, entity_type, MIN(distance) as distance, link_type
    FROM connected
    GROUP BY entity_id, entity_type
    ORDER BY distance ASC, entity_id ASC
  `).all(entityId, maxDepth, entityId) as LinkedEntity[];

  return result;
}

/**
 * Get direct links from an entity (outgoing only, no recursion)
 */
export function getDirectLinks(
  db: Database.Database,
  entityId: string,
  direction: 'outgoing' | 'incoming' | 'both' = 'both'
): { links: any[] } {
  if (direction === 'outgoing') {
    return { links: db.prepare('SELECT * FROM entity_links WHERE from_entity_id = ? ORDER BY created_at DESC').all(entityId) };
  } else if (direction === 'incoming') {
    return { links: db.prepare('SELECT * FROM entity_links WHERE to_entity_id = ? ORDER BY created_at DESC').all(entityId) };
  } else {
    return { links: db.prepare('SELECT * FROM entity_links WHERE from_entity_id = ? OR to_entity_id = ? ORDER BY created_at DESC').all(entityId, entityId) };
  }
}

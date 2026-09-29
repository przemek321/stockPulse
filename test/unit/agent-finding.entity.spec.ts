/**
 * Test kształtu encji AgentFinding (tasks-2026-09-27/01) — bez bazy, przez metadane TypeORM.
 *
 * Pilnuje decyzji projektowych, których złamanie boli na prod:
 * - varchar zamiast pg enum (synchronize:true + enum = crash-loop 27.07.2026),
 * - brak relacji/FK (audyt ma przeżyć archiwizację/DELETE alertów),
 * - unikalny indeks częściowy (alertId, checkId) = idempotencja per (alert, check),
 * - nazwy kolumn dokładnie takie, do jakich odwołują się checki (03), orkiestrator (05) i MCP (02).
 */

import { getMetadataArgsStorage } from 'typeorm';
import * as entitiesIndex from '../../src/entities';
import { AgentFinding } from '../../src/entities/agent-finding.entity';

const storage = getMetadataArgsStorage();
const ownColumns = () => storage.columns.filter((c) => c.target === AgentFinding);

describe('AgentFinding — encja agent_findings', () => {
  it('mapuje na tabelę agent_findings i jest eksportowana z src/entities', () => {
    const table = storage.tables.find((t) => t.target === AgentFinding);
    expect(table?.name).toBe('agent_findings');
    expect(entitiesIndex.AgentFinding).toBe(AgentFinding);
  });

  it('ma dokładnie 13 kolumn o nazwach z planu', () => {
    const names = ownColumns()
      .map((c) => c.propertyName)
      .sort();
    expect(names).toEqual(
      [
        'id',
        'createdAt',
        'alertId',
        'ticker',
        'accessionNumber',
        'agent',
        'checkId',
        'severity',
        'source',
        'summary',
        'evidence',
        'status',
        'pipelineVersion',
      ].sort(),
    );
  });

  it('agent/severity/source/status to varchar, NIE pg enum', () => {
    for (const name of ['agent', 'severity', 'source', 'status']) {
      const col = ownColumns().find((c) => c.propertyName === name);
      expect(col?.options.type).toBe('varchar');
      expect(col?.options.enum).toBeUndefined();
    }
  });

  it('status ma default OPEN; evidence to jsonb; alertId nullable int', () => {
    const status = ownColumns().find((c) => c.propertyName === 'status');
    expect(status?.options.default).toBe('OPEN');
    const evidence = ownColumns().find((c) => c.propertyName === 'evidence');
    expect(evidence?.options.type).toBe('jsonb');
    const alertId = ownColumns().find((c) => c.propertyName === 'alertId');
    expect(alertId?.options.type).toBe('int');
    expect(alertId?.options.nullable).toBe(true);
  });

  it('nie ma żadnej relacji ani FK do alerts', () => {
    const relations = storage.relations.filter((r) => r.target === AgentFinding);
    expect(relations).toHaveLength(0);
  });

  it('ma 4 indeksy, w tym unikalny częściowy (alertId, checkId) WHERE alertId IS NOT NULL', () => {
    const indices = storage.indices.filter((i) => i.target === AgentFinding);
    expect(indices).toHaveLength(4);
    const unique = indices.filter((i) => i.unique === true);
    expect(unique).toHaveLength(1);
    expect(unique[0].columns).toEqual(['alertId', 'checkId']);
    expect(unique[0].where).toBe('"alertId" IS NOT NULL');
    const plain = indices
      .filter((i) => i.unique !== true)
      .map((i) => i.columns)
      .sort();
    expect(plain).toEqual([['alertId'], ['agent', 'checkId', 'status'], ['createdAt']].sort());
  });
});

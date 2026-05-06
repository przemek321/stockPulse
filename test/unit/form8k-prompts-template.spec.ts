/**
 * Regression guard dla prompt template'ów 8-K.
 *
 * Trigger: HUM 29.04.2026 false positive miał root cause głębszy niż FIX-01:
 * `form8k-2-02.prompt.ts` miało HARDCODED `"requires_immediate_attention": true`
 * w JSON template, więc LLM kopiował to literally — ZAWSZE zwracał true,
 * niezależnie od faktycznej istotności filingu. To deterministyczny prompt
 * design error, który wytwarzał false positives na każdym 8-K Item 2.02.
 *
 * Fix: zmiana template'u na `false` jako default + explicit decision rule
 * (set TRUE only if |conviction| >= 1.0 AND magnitude=high AND confidence>=0.7
 * AND key_facts mają concrete numbers).
 *
 * Ten test BLOKUJE regresję — gdyby ktoś wrócił do hardcoded `true`, test
 * fail'uje natychmiast.
 */

import { buildForm8k202Prompt } from '../../src/sec-filings/prompts/form8k-2-02.prompt';
import { buildForm8k101Prompt } from '../../src/sec-filings/prompts/form8k-1-01.prompt';
import { buildForm8k502Prompt } from '../../src/sec-filings/prompts/form8k-5-02.prompt';
import { buildForm8kOtherPrompt } from '../../src/sec-filings/prompts/form8k-other.prompt';

describe('form8k prompts — requires_immediate_attention NIE może być hardcoded true', () => {
  it('Item 2.02 (earnings): default false + explicit decision rule', () => {
    const prompt = buildForm8k202Prompt('HUM', 'Humana', 'Q1 results...');
    expect(prompt).not.toMatch(/"requires_immediate_attention":\s*true\s*[}\n]/);
    expect(prompt).toMatch(/"requires_immediate_attention":\s*false/);
    expect(prompt).toMatch(/REQUIRES_IMMEDIATE_ATTENTION DECISION RULE/);
    expect(prompt).toMatch(/Set to TRUE only if ALL/);
  });

  it('Item 1.01 (contract): instructional true|false (nie hardcoded)', () => {
    const prompt = buildForm8k101Prompt('AMGN', 'Amgen', 'Material agreement...');
    expect(prompt).toMatch(/"requires_immediate_attention":\s*true\|false/);
    expect(prompt).not.toMatch(/"requires_immediate_attention":\s*true\s*[}\n]/);
  });

  it('Item 5.02 (leadership): instructional true|false', () => {
    const prompt = buildForm8k502Prompt('PFE', 'Pfizer', 'CEO departure...');
    expect(prompt).toMatch(/"requires_immediate_attention":\s*true\|false/);
  });

  it('Item other: instructional true|false', () => {
    const prompt = buildForm8kOtherPrompt('JNJ', 'Johnson & Johnson', 'FDA approval...');
    expect(prompt).toMatch(/"requires_immediate_attention":\s*true\|false/);
  });
});

describe('form8k 2.02 prompt — extractedFacts injection (S19-FIX-02 integration)', () => {
  it('z extractedFacts → block "CONFIRMED FACTS" w prompcie', () => {
    const prompt = buildForm8k202Prompt(
      'HUM',
      'Humana',
      'Q1 results...',
      '2.02',
      null,
      '- guidance_status: AFFIRMED_ADJUSTED\n  → Constraint: conviction must NOT be more negative than -0.3.',
    );
    expect(prompt).toMatch(/CONFIRMED FACTS/);
    expect(prompt).toMatch(/AFFIRMED_ADJUSTED/);
    expect(prompt).toMatch(/Constraint: conviction must NOT be more negative than -0\.3/);
  });

  it('bez extractedFacts → brak sekcji CONFIRMED FACTS (default behaviour)', () => {
    const prompt = buildForm8k202Prompt('HUM', 'Humana', 'Q1 results...');
    expect(prompt).not.toMatch(/CONFIRMED FACTS/);
  });
});

describe('form8k 2.02 prompt — KEY_FACTS instruction (anti-halucynacja)', () => {
  it('explicit instruction żeby NIE zapisywać "niedostępne" jako fact', () => {
    const prompt = buildForm8k202Prompt('HUM', 'Humana', 'short text');
    expect(prompt).toMatch(/KEY_FACTS RULE/);
    expect(prompt).toMatch(/OMIT that\s+key_fact entirely/);
    expect(prompt).toMatch(/do NOT write "niedostępne"/);
  });
});

describe('form8k 2.02 prompt — consensusBlock injection (S19-FIX-12)', () => {
  const consensusSample = `## ANALYST CONSENSUS (pre-earnings)
- EPS estimate: $1.22 → actual $1.42 (surprise: +16.4% **STRONG BEAT**)
- Revenue estimate: $789.3M → actual $761.7M (surprise: -3.5% miss)`;

  it('consensus block wstawiony PRZED CONFIRMED FACTS', () => {
    const prompt = buildForm8k202Prompt(
      'PODD', 'Insulet', 'Q1 text...', '2.02', null, '- guidance: AFFIRMED', consensusSample,
    );
    expect(prompt).toContain('ANALYST CONSENSUS');
    expect(prompt).toContain('STRONG BEAT');
    expect(prompt).toContain('-3.5%');

    // Order: consensus PRZED confirmed facts
    const consensusIdx = prompt.indexOf('ANALYST CONSENSUS');
    const factsIdx = prompt.indexOf('CONFIRMED FACTS');
    expect(consensusIdx).toBeGreaterThan(0);
    expect(factsIdx).toBeGreaterThan(consensusIdx);
  });

  it('bez consensus block → prompt nie zawiera ANALYST CONSENSUS (default)', () => {
    const prompt = buildForm8k202Prompt('PODD', 'Insulet', 'Q1 text...');
    expect(prompt).not.toContain('ANALYST CONSENSUS');
  });

  it('null consensus block → graceful (no inject)', () => {
    const prompt = buildForm8k202Prompt(
      'PODD', 'Insulet', 'Q1 text...', '2.02', null, null, null,
    );
    expect(prompt).not.toContain('ANALYST CONSENSUS');
  });

  it('consensus block + brak guidance facts → tylko consensus inject', () => {
    const prompt = buildForm8k202Prompt(
      'PODD', 'Insulet', 'Q1 text...', '2.02', null, null, consensusSample,
    );
    expect(prompt).toContain('ANALYST CONSENSUS');
    expect(prompt).not.toContain('CONFIRMED FACTS');
  });
});

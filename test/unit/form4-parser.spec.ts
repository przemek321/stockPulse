import { parseForm4Xml, Form4Transaction } from '../../src/collectors/sec-edgar/form4-parser';

/**
 * Testy parsera Form 4 — nowe pola is10b51Plan i sharesOwnedAfter.
 */
describe('Form4 Parser', () => {
  const makeXml = (overrides: {
    code?: string;
    shares?: number;
    price?: number;
    rule10b51?: string;
    sharesAfter?: string;
  } = {}): string => {
    const code = overrides.code ?? 'P';
    const shares = overrides.shares ?? 1000;
    const price = overrides.price ?? 50;
    const rule10b51 = overrides.rule10b51 ?? '';
    const sharesAfterTag = overrides.sharesAfter != null
      ? `<postTransactionAmounts><sharesOwnedFollowingTransaction><value>${overrides.sharesAfter}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>`
      : '';

    return `<?xml version="1.0"?>
    <ownershipDocument>
      <reportingOwner>
        <reportingOwnerId><rptOwnerName>John Smith</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship><officerTitle>CEO</officerTitle></reportingOwnerRelationship>
      </reportingOwner>
      <nonDerivativeTable>
        <nonDerivativeTransaction>
          <transactionDate><value>2026-03-01</value></transactionDate>
          <transactionCoding>
            <transactionCode>${code}</transactionCode>
            ${rule10b51 ? `<Rule10b5-1Transaction>${rule10b51}</Rule10b5-1Transaction>` : ''}
          </transactionCoding>
          <transactionAmounts>
            <transactionShares><value>${shares}</value></transactionShares>
            <transactionPricePerShare><value>${price}</value></transactionPricePerShare>
          </transactionAmounts>
          ${sharesAfterTag}
        </nonDerivativeTransaction>
      </nonDerivativeTable>
    </ownershipDocument>`;
  };

  it('parsuje transakcję BUY z danymi podstawowymi', () => {
    const result = parseForm4Xml(makeXml());
    expect(result).toHaveLength(1);
    expect(result[0].transactionType).toBe('BUY');
    expect(result[0].insiderName).toBe('John Smith');
    expect(result[0].insiderRole).toBe('CEO');
    expect(result[0].shares).toBe(1000);
    expect(result[0].pricePerShare).toBe(50);
    expect(result[0].totalValue).toBe(50000);
  });

  it('wykrywa plan 10b5-1 z wartością "1"', () => {
    const result = parseForm4Xml(makeXml({ rule10b51: '1' }));
    expect(result[0].is10b51Plan).toBe(true);
  });

  it('wykrywa plan 10b5-1 z wartością "Y"', () => {
    const result = parseForm4Xml(makeXml({ rule10b51: 'Y' }));
    expect(result[0].is10b51Plan).toBe(true);
  });

  it('brak planu 10b5-1 gdy pusta wartość', () => {
    const result = parseForm4Xml(makeXml({ rule10b51: '' }));
    expect(result[0].is10b51Plan).toBe(false);
  });

  it('brak planu 10b5-1 gdy brak tagu', () => {
    const result = parseForm4Xml(makeXml());
    expect(result[0].is10b51Plan).toBe(false);
  });

  it('parsuje sharesOwnedAfter', () => {
    const result = parseForm4Xml(makeXml({ sharesAfter: '50000' }));
    expect(result[0].sharesOwnedAfter).toBe(50000);
  });

  it('sharesOwnedAfter = null gdy brak tagu', () => {
    const result = parseForm4Xml(makeXml());
    expect(result[0].sharesOwnedAfter).toBeNull();
  });

  it('parsuje sharesOwnedAfter z wartością dziesiętną', () => {
    const result = parseForm4Xml(makeXml({ sharesAfter: '12345.67' }));
    expect(result[0].sharesOwnedAfter).toBeCloseTo(12345.67);
  });

  it('ignoruje transakcje bez akcji (shares=0)', () => {
    const result = parseForm4Xml(makeXml({ shares: 0 }));
    expect(result).toHaveLength(0);
  });

  it('mapuje kod S na SELL', () => {
    const result = parseForm4Xml(makeXml({ code: 'S' }));
    expect(result[0].transactionType).toBe('SELL');
  });

  it('mapuje kod M na EXERCISE', () => {
    const result = parseForm4Xml(makeXml({ code: 'M' }));
    expect(result[0].transactionType).toBe('EXERCISE');
  });

  // ── FLAG #30 fix: multi-reportingOwner ──────────────────────

  describe('Multi-reportingOwner (FLAG #30 fix)', () => {
    const makeMultiOwnerXml = (owners: Array<{
      name: string;
      officerTitle?: string;
      isDirector?: boolean;
      isOfficer?: boolean;
    }>, code: string = 'P'): string => {
      const ownersXml = owners.map(o => {
        const rel: string[] = [];
        if (o.officerTitle) rel.push(`<officerTitle>${o.officerTitle}</officerTitle>`);
        if (o.isOfficer) rel.push(`<isOfficer>1</isOfficer>`);
        if (o.isDirector) rel.push(`<isDirector>1</isDirector>`);

        return `<reportingOwner>
          <reportingOwnerId><rptOwnerName>${o.name}</rptOwnerName></reportingOwnerId>
          <reportingOwnerRelationship>${rel.join('')}</reportingOwnerRelationship>
        </reportingOwner>`;
      }).join('');

      return `<?xml version="1.0"?>
      <ownershipDocument>
        ${ownersXml}
        <nonDerivativeTable>
          <nonDerivativeTransaction>
            <transactionDate><value>2026-03-01</value></transactionDate>
            <transactionCoding>
              <transactionCode>${code}</transactionCode>
            </transactionCoding>
            <transactionAmounts>
              <transactionShares><value>1000</value></transactionShares>
              <transactionPricePerShare><value>50</value></transactionPricePerShare>
            </transactionAmounts>
          </nonDerivativeTransaction>
        </nonDerivativeTable>
      </ownershipDocument>`;
    };

    it('1 owner — zachowuje dotychczasowe zachowanie', () => {
      const xml = makeMultiOwnerXml([
        { name: 'Smith John', officerTitle: 'CEO' },
      ]);
      const result = parseForm4Xml(xml);
      expect(result).toHaveLength(1);
      expect(result[0].insiderName).toBe('Smith John');
      expect(result[0].insiderRole).toBe('CEO');
    });

    it('2 owners CEO + Director — role łączone (nie traci CEO)', () => {
      const xml = makeMultiOwnerXml([
        { name: 'Smith John', officerTitle: 'CEO' },
        { name: 'Smith Jane', isDirector: true },
      ]);
      const result = parseForm4Xml(xml);
      expect(result).toHaveLength(1);
      expect(result[0].insiderRole).toContain('CEO');
      expect(result[0].insiderRole).toContain('Director');
    });

    it('2 owners Director + CEO — C-suite zachowany mimo kolejności', () => {
      const xml = makeMultiOwnerXml([
        { name: 'Smith Jane', isDirector: true },
        { name: 'Smith John', officerTitle: 'CEO' },
      ]);
      const result = parseForm4Xml(xml);
      expect(result).toHaveLength(1);
      expect(result[0].insiderRole).toContain('CEO');
      expect(result[0].insiderRole).toContain('Director');
    });

    it('co-filing — nazwa insidera zawiera obu', () => {
      const xml = makeMultiOwnerXml([
        { name: 'Smith John', officerTitle: 'CEO' },
        { name: 'Smith Jane', isDirector: true },
      ]);
      const result = parseForm4Xml(xml);
      expect(result[0].insiderName).toContain('Smith John');
      expect(result[0].insiderName).toContain('co-filing');
    });

    it('pusty reportingOwner array — fallback do Unknown', () => {
      const xml = `<?xml version="1.0"?>
      <ownershipDocument>
        <nonDerivativeTable>
          <nonDerivativeTransaction>
            <transactionDate><value>2026-03-01</value></transactionDate>
            <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
            <transactionAmounts>
              <transactionShares><value>1000</value></transactionShares>
              <transactionPricePerShare><value>50</value></transactionPricePerShare>
            </transactionAmounts>
          </nonDerivativeTransaction>
        </nonDerivativeTable>
      </ownershipDocument>`;
      const result = parseForm4Xml(xml);
      expect(result[0].insiderName).toBe('Unknown');
      expect(result[0].insiderRole).toBeNull();
    });
  });
});

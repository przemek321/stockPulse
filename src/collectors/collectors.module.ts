import { Module } from '@nestjs/common';
import { FinnhubModule } from './finnhub/finnhub.module';
import { Form4DiscoveryModule } from './form4-discovery/form4-discovery.module';
import { OptionsFlowCollectorModule } from './options-flow/options-flow.module';
import { PdufaBioModule } from './pdufa-bio/pdufa-bio.module';
import { RedditModule } from './reddit/reddit.module';
import { SecEdgarModule } from './sec-edgar/sec-edgar.module';
import { StocktwitsModule } from './stocktwits/stocktwits.module';

/**
 * Zbiorczy moduł kolektorów danych.
 * Importuje wszystkie kolektory: StockTwits, Finnhub, SEC EDGAR, Reddit, PDUFA.bio,
 * Options Flow (CRON off 10.06.2026), Form4 Discovery (Pakiet 2).
 */
@Module({
  imports: [StocktwitsModule, FinnhubModule, SecEdgarModule, RedditModule, PdufaBioModule, OptionsFlowCollectorModule, Form4DiscoveryModule],
  exports: [StocktwitsModule, FinnhubModule, SecEdgarModule, RedditModule, PdufaBioModule, OptionsFlowCollectorModule, Form4DiscoveryModule],
})
export class CollectorsModule {}

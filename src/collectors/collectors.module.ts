import { Module } from '@nestjs/common';
import { StocktwitsModule } from './stocktwits/stocktwits.module';
import { FinnhubModule } from './finnhub/finnhub.module';
import { SecEdgarModule } from './sec-edgar/sec-edgar.module';
import { RedditModule } from './reddit/reddit.module';
import { PdufaBioModule } from './pdufa-bio/pdufa-bio.module';
import { OptionsFlowCollectorModule } from './options-flow/options-flow.module';

/**
 * Zbiorczy moduł kolektorów danych.
 * Importuje wszystkie kolektory: StockTwits, Finnhub, SEC EDGAR, Reddit, PDUFA.bio, Options Flow.
 */
@Module({
  imports: [StocktwitsModule, FinnhubModule, SecEdgarModule, RedditModule, PdufaBioModule, OptionsFlowCollectorModule],
  exports: [StocktwitsModule, FinnhubModule, SecEdgarModule, RedditModule, PdufaBioModule, OptionsFlowCollectorModule],
})
export class CollectorsModule {}

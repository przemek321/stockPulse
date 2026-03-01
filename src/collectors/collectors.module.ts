import { Module } from '@nestjs/common';
import { StocktwitsModule } from './stocktwits/stocktwits.module';
import { FinnhubModule } from './finnhub/finnhub.module';
import { SecEdgarModule } from './sec-edgar/sec-edgar.module';
import { RedditModule } from './reddit/reddit.module';
import { PdufaBioModule } from './pdufa-bio/pdufa-bio.module';

/**
 * Zbiorczy moduł kolektorów danych.
 * Importuje wszystkie kolektory: StockTwits, Finnhub, SEC EDGAR, Reddit, PDUFA.bio.
 */
@Module({
  imports: [StocktwitsModule, FinnhubModule, SecEdgarModule, RedditModule, PdufaBioModule],
  exports: [StocktwitsModule, FinnhubModule, SecEdgarModule, RedditModule, PdufaBioModule],
})
export class CollectorsModule {}

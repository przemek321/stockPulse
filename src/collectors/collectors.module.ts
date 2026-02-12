import { Module } from '@nestjs/common';
import { StocktwitsModule } from './stocktwits/stocktwits.module';
import { FinnhubModule } from './finnhub/finnhub.module';
import { SecEdgarModule } from './sec-edgar/sec-edgar.module';
import { RedditModule } from './reddit/reddit.module';

/**
 * Zbiorczy moduł kolektorów danych.
 * Importuje wszystkie kolektory: StockTwits, Finnhub, SEC EDGAR, Reddit.
 */
@Module({
  imports: [StocktwitsModule, FinnhubModule, SecEdgarModule, RedditModule],
  exports: [StocktwitsModule, FinnhubModule, SecEdgarModule, RedditModule],
})
export class CollectorsModule {}

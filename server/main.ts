import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
// The platform's bundled CJS entry loads this declared runtime dependency;
// keep it explicit so dependency tracing includes it in an isolated package.
import '@nestjs/config';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import { join } from 'path';
import { __express as hbsExpressEngine } from 'hbs';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { createTdmsDailyHttpParser } from './modules/tdms-source/tdms-daily-http-parser';
import { createCanonicalCodexMcpHttpParser } from './modules/canonical-host/canonical-codex-mcp-http-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: process.env.NODE_ENV !== 'development',
  });
  app.use(createTdmsDailyHttpParser());
  app.use(createCanonicalCodexMcpHttpParser());
  await configureApp(app, {
    disableSwagger: true,
  });
  const logger = new Logger('Bootstrap');
  const host = process.env.SERVER_HOST || 'localhost';
  const port = Number(process.env.SERVER_PORT || '3000');

  // 注册视图引擎, 渲染 client 目录下的 html 文件
  app.setBaseViewsDir(join(process.cwd(), 'dist/client'));
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);

  await app.listen(port, host);
  logger.log(`Server running on ${host}:${port}`);
  logger.log(`API endpoints ready at http://${host}:${port}/api`);
}

bootstrap();

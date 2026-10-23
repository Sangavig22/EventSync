import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    // Keep the raw request bytes around so Stripe webhook signatures can be
    // verified against exactly what Stripe sent. Existing JSON endpoints are
    // unaffected: the body is still parsed as JSON as before.
    rawBody: true,
  });
  app.use(cookieParser());
  app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

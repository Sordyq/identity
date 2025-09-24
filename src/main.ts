// src/main.ts
import { NestFactory } from '@nestjs/core';          // NestJS core factory
import { ValidationPipe } from '@nestjs/common';     // Input validation
import { AppModule } from './app.module';            // Root application module
import { HttpExceptionFilter } from './filters/http-exception.filter'; // Error handler

async function bootstrap() {
  const app = await NestFactory.create(AppModule);   // Create NestJS application instance
  
  // Global validation pipe - validates all incoming requests
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,           // Remove properties not in DTO
    forbidNonWhitelisted: true, // Throw error if extra properties exist
    transform: true,           // Automatically transform payloads to DTO instances
  }));
  
  app.useGlobalFilters(new HttpExceptionFilter()); // Global error handling
  
  // Enable CORS for frontend communication
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001', // Allow frontend
    credentials: true,          // Allow cookies/auth headers
  });
  
  const port = process.env.PORT || 3000;            // Server port
  await app.listen(port);                           // Start server
  // console.log(`Application running on port ${port}`);
}
bootstrap();
// src/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)  // Catch only HttpException types
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();           // Get HTTP context
    const response = ctx.getResponse<Response>(); // HTTP response object
    const request = ctx.getRequest<Request>();   // HTTP request object
    const status = exception.getStatus();        // HTTP status code

    // Standardized error response format
    response.status(status).json({
      statusCode: status,                      // HTTP status code
      timestamp: new Date().toISOString(),     // Error timestamp
      path: request.url,                       // Request URL
      message: exception.message,              // Error message
      error: exception.name,                   // Error type/name
    });
  }
}
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ProcessPaymentDto } from './dto/process-payment.dto';
import { PaymentService } from './payment.service';

@ApiTags('payments')
@Controller()
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post('process-payment')
  @ApiOperation({ summary: 'Process a payment (idempotent)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: ProcessPaymentDto })
  async processPayment(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: ProcessPaymentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = idempotencyKey?.trim();
    if (!key) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const { statusCode, body: payload, cacheHit } =
      await this.payments.processPayment(key, body);

    res.status(statusCode);
    if (cacheHit) {
      res.setHeader('X-Cache-Hit', 'true');
    }
    return payload;
  }
}

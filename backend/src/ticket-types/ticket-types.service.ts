import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';

@Injectable()
export class TicketTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(eventId: string, createTicketTypeDto: CreateTicketTypeDto) {
    await this.ensureEventExists(eventId);
    return this.prisma.ticketType.create({
      data: {
        name: createTicketTypeDto.name,
        description: createTicketTypeDto.description,
        price: new Prisma.Decimal(createTicketTypeDto.price),
        quantity: createTicketTypeDto.quantity,
        eventId,
      },
    });
  }

  async findAll(eventId: string) {
    await this.ensureEventExists(eventId);
    return this.prisma.ticketType.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        quantity: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private async ensureEventExists(eventId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) {
      throw new NotFoundException(`Event with id ${eventId} not found`);
    }
  }
}
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RegistrationStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { throwPrismaError } from '../common/prisma-error.util';

@Injectable()
export class RegistrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(eventId: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { status: true, maxAttendees: true },
    });
    if (!event) {
      throw new NotFoundException(`Event with id ${eventId} not found`);
    }
    if (event.status !== 'PUBLISHED') {
      throw new ConflictException('Event is not open for registration');
    }

    const existing = await this.prisma.registration.findUnique({
      where: { userId_eventId: { userId, eventId } },
    });

    if (existing) {
      if (existing.status === RegistrationStatus.CANCELLED) {
        await this.checkCapacity(eventId, event.maxAttendees);
        try {
          return await this.prisma.registration.update({
            where: { userId_eventId: { userId, eventId } },
            data: {
              status: RegistrationStatus.CONFIRMED,
              cancelledAt: null,
            },
          });
        } catch (error) {
          throwPrismaError(error);
        }
      }
      throw new ConflictException('User is already registered for this event');
    }

    await this.checkCapacity(eventId, event.maxAttendees);

    try {
      return await this.prisma.registration.create({
        data: {
          userId,
          eventId,
          status: RegistrationStatus.CONFIRMED,
        },
      });
    } catch (error) {
      throwPrismaError(error);
    }
  }

  private async checkCapacity(
    eventId: string,
    maxAttendees: number | null,
  ): Promise<void> {
    if (maxAttendees === null) {
      return;
    }

    const activeRegistrationCount = await this.prisma.registration.count({
      where: {
        eventId,
        status: {
          not: RegistrationStatus.CANCELLED,
        },
      },
    });

    if (activeRegistrationCount >= maxAttendees) {
      throw new ConflictException('Event is at full capacity');
    }
  }
}
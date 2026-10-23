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
    // Use a transaction to ensure that the registration
    return this.prisma.$transaction(async (tx) => {
      // Lock the event row so concurrent registrations
      // for the same event are processed one at a time.
      const events = await tx.$queryRaw<
        {
          id: string;
          status: string;
          maxAttendees: number | null;
        }[]
      >`
        SELECT id, status, "maxAttendees"
        FROM "Event"
        WHERE id = ${eventId}
        FOR UPDATE
      `;

      const event = events[0];
    
      // Check if the event exists registration
      if (!event) {
        throw new NotFoundException(
          `Event with id ${eventId} not found`,
        );
      }
      // Check if the event is open for registration
      if (event.status !== 'PUBLISHED') {
        throw new ConflictException(
          'Event is not open for registration',
        );
      }
      // Check if the user is already registered for the event
      const existing = await tx.registration.findUnique({
        where: {
          userId_eventId: {
            userId,
            eventId,
          },
        },
      });

      if (existing) {
        // Allow a previously cancelled registration
        // to be reactivated.
        if (existing.status === RegistrationStatus.CANCELLED) {
          if (event.maxAttendees !== null) {
            const activeRegistrationCount =
              await tx.registration.count({
                where: {
                  eventId,
                  status: {
                    not: RegistrationStatus.CANCELLED,
                  },
                },
              });
        // Check if the event is at full capacity
            if (
              activeRegistrationCount >= event.maxAttendees
            ) {
              throw new ConflictException(
                'Event is at full capacity',
              );
            }
          }
        // Reactivate the cancelled registration.
          try {
            return await tx.registration.update({
              where: {
                userId_eventId: {
                  userId,
                  eventId,
                },
              },
              data: {
                status: RegistrationStatus.CONFIRMED,
                cancelledAt: null,
              },
            });
          } catch (error) {
            throwPrismaError(error);
          }
        }

        throw new ConflictException(
          'User is already registered for this event',
        );
      }

      // Check capacity for a new registration.
      if (event.maxAttendees !== null) {
        const activeRegistrationCount =
          await tx.registration.count({
            where: {
              eventId,
              status: {
                not: RegistrationStatus.CANCELLED,
              },
            },
          });

        if (
          activeRegistrationCount >= event.maxAttendees
        ) {
          throw new ConflictException(
            'Event is at full capacity',
          );
        }
      }
      // Create a new registration

      try {
        return await tx.registration.create({
          data: {
            userId,
            eventId,
            status: RegistrationStatus.CONFIRMED,
          },
        });
      } catch (error) {
        throwPrismaError(error);
      }
    });
  }

  async cancel(eventId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the event row so cancel and (re)registration
      // for the same event are processed one at a time.
      const events = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM "Event"
        WHERE id = ${eventId}
        FOR UPDATE
      `;

      const event = events[0];

      if (!event) {
        throw new NotFoundException(
          `Event with id ${eventId} not found`,
        );
      }

      const existing = await tx.registration.findUnique({
        where: {
          userId_eventId: {
            userId,
            eventId,
          },
        },
      });

      if (!existing) {
        throw new NotFoundException('Registration not found');
      }

      if (existing.status === RegistrationStatus.CANCELLED) {
        throw new ConflictException(
          'Registration is already cancelled',
        );
      }

      return tx.registration.update({
        where: {
          userId_eventId: {
            userId,
            eventId,
          },
        },
        data: {
          status: RegistrationStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });
    });
  }

  findMine(userId: string) {
    return this.prisma.registration.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            startDate: true,
            endDate: true,
            maxAttendees: true,
            organization: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });
  }

  findByEvent(eventId: string) {
    return this.prisma.registration.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }
}
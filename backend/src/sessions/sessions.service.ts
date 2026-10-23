import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import {
  isForeignKeyViolation,
  throwPrismaError,
} from '../common/prisma-error.util';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(eventId: string, createSessionDto: CreateSessionDto) {
    await this.ensureEventExists(eventId);
    this.assertTimeRange(createSessionDto.startTime, createSessionDto.endTime);

    try {
      return await this.prisma.session.create({
        data: { ...createSessionDto, eventId },
      });
    } catch (error) {
      throwPrismaError(error);
    }
  }

  async findAllByEvent(eventId: string) {
    await this.ensureEventExists(eventId);
    return this.prisma.session.findMany({
      where: { eventId },
      include: { speakers: { include: { speaker: true } } },
      orderBy: { startTime: 'asc' },
    });
  }

  async findOneByEvent(eventId: string, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, eventId },
      include: {
        event: true,
        speakers: { include: { speaker: true } },
      },
    });
    if (!session) {
      throw new NotFoundException(
        `Session with id ${sessionId} not found for event ${eventId}`,
      );
    }
    return session;
  }

  async update(
    eventId: string,
    sessionId: string,
    updateSessionDto: UpdateSessionDto,
  ) {
    const existing = await this.findOneByEvent(eventId, sessionId);

    const startTime = updateSessionDto.startTime ?? existing.startTime;
    const endTime = updateSessionDto.endTime ?? existing.endTime;
    this.assertTimeRange(startTime, endTime);

    try {
      return await this.prisma.session.update({
        where: { id: sessionId },
        data: updateSessionDto,
      });
    } catch (error) {
      throwPrismaError(error);
    }
  }

  async remove(eventId: string, sessionId: string) {
    await this.findOneByEvent(eventId, sessionId);
    try {
      await this.prisma.session.delete({ where: { id: sessionId } });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Cannot delete the session because speakers are assigned to it',
        );
      }
      throwPrismaError(error);
    }
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

  private assertTimeRange(
    startTime: string | Date,
    endTime: string | Date,
  ): void {
    if (new Date(startTime).getTime() >= new Date(endTime).getTime()) {
      throw new BadRequestException('startTime must be before endTime');
    }
  }

  async assignSpeaker(sessionId: string, speakerId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`Session with id ${sessionId} not found`);
    }

    const speaker = await this.prisma.speaker.findUnique({
      where: { id: speakerId },
    });
    if (!speaker) {
      throw new NotFoundException(`Speaker with id ${speakerId} not found`);
    }

    const existing = await this.prisma.sessionSpeaker.findUnique({
      where: { sessionId_speakerId: { sessionId, speakerId } },
    });
    if (existing) {
      throw new ConflictException(
        'Speaker is already assigned to this session',
      );
    }

    return this.prisma.sessionSpeaker.create({
      data: { sessionId, speakerId },
      include: { speaker: true },
    });
  }

  async listSpeakers(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`Session with id ${sessionId} not found`);
    }
    return this.prisma.sessionSpeaker.findMany({
      where: { sessionId },
      include: { speaker: true },
    });
  }

  async unassignSpeaker(sessionId: string, speakerId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`Session with id ${sessionId} not found`);
    }

    const assignment = await this.prisma.sessionSpeaker.findUnique({
      where: { sessionId_speakerId: { sessionId, speakerId } },
    });
    if (!assignment) {
      throw new NotFoundException(
        `Speaker ${speakerId} is not assigned to session ${sessionId}`,
      );
    }

    await this.prisma.sessionSpeaker.delete({
      where: { sessionId_speakerId: { sessionId, speakerId } },
    });
  }
}
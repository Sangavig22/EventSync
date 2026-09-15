import {
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
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) {
      throw new NotFoundException(`Event with id ${eventId} not found`);
    }
    return this.prisma.session.create({
      data: { ...createSessionDto, eventId },
    });
  }

  async findAllByEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) {
      throw new NotFoundException(`Event with id ${eventId} not found`);
    }
    return this.prisma.session.findMany({
      where: { eventId },
      include: { speakers: { include: { speaker: true } } },
      orderBy: { startTime: 'asc' },
    });
  }

  async findOne(id: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: {
        event: true,
        speakers: { include: { speaker: true } },
      },
    });
    if (!session) {
      throw new NotFoundException(`Session with id ${id} not found`);
    }
    return session;
  }

  async update(id: string, updateSessionDto: UpdateSessionDto) {
    await this.findOne(id);
    try {
      return await this.prisma.session.update({
        where: { id },
        data: updateSessionDto,
      });
    } catch (error) {
      throwPrismaError(error);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.session.delete({ where: { id } });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Cannot delete the session because speakers are assigned to it',
        );
      }
      throwPrismaError(error);
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
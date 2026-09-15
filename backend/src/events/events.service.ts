import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import {
  isForeignKeyViolation,
  throwPrismaError,
} from '../common/prisma-error.util';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createEventDto: CreateEventDto) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: createEventDto.organizationId },
    });
    if (!organization) {
      throw new NotFoundException(
        `Organization with id ${createEventDto.organizationId} not found`,
      );
    }
    return this.prisma.event.create({ data: createEventDto });
  }

  findAll() {
    return this.prisma.event.findMany({
      include: { organization: true, sessions: true },
    });
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { organization: true, sessions: true },
    });
    if (!event) {
      throw new NotFoundException(`Event with id ${id} not found`);
    }
    return event;
  }

  async update(id: string, updateEventDto: UpdateEventDto) {
    if (updateEventDto.organizationId) {
      const organization = await this.prisma.organization.findUnique({
        where: { id: updateEventDto.organizationId },
      });
      if (!organization) {
        throw new NotFoundException(
          `Organization with id ${updateEventDto.organizationId} not found`,
        );
      }
    }

    await this.findOne(id);
    try {
      return await this.prisma.event.update({
        where: { id },
        data: updateEventDto,
      });
    } catch (error) {
      throwPrismaError(error);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.event.delete({ where: { id } });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Cannot delete the event because it has sessions',
        );
      }
      throwPrismaError(error);
    }
  }
}
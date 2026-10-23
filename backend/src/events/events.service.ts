import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { DiscoverEventsDto } from './dto/discover-events.dto';
import { Prisma } from '../generated/prisma/client';
import {
  isForeignKeyViolation,
  throwPrismaError,
} from '../common/prisma-error.util';

const SORT_BY_FIELD_MAP: Record<string, 'startDate' | 'createdAt' | 'title'> = {
  startDate: 'startDate',
  startTime: 'startDate',
  createdAt: 'createdAt',
  title: 'title',
};

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

  async discover(discoverEventsDto: DiscoverEventsDto) {
    const page = discoverEventsDto.page ?? 1;
    const limit = discoverEventsDto.limit ?? 20;
    const sortField =
      SORT_BY_FIELD_MAP[discoverEventsDto.sortBy ?? 'startDate'] ?? 'startDate';
    const sortOrder: Prisma.SortOrder = discoverEventsDto.sortOrder ?? 'asc';

    const from = discoverEventsDto.from
      ? new Date(discoverEventsDto.from)
      : undefined;
    const to = discoverEventsDto.to
      ? new Date(discoverEventsDto.to)
      : undefined;

    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('from must not be later than to');
    }

    const where: Prisma.EventWhereInput = { status: 'PUBLISHED' };

    if (discoverEventsDto.search) {
      where.OR = [
        { title: { contains: discoverEventsDto.search, mode: 'insensitive' } },
        {
          description: {
            contains: discoverEventsDto.search,
            mode: 'insensitive',
          },
        },
        {
          location: {
            contains: discoverEventsDto.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (discoverEventsDto.location) {
      where.location = {
        contains: discoverEventsDto.location,
        mode: 'insensitive',
      };
    }

    if (from || to) {
      where.startDate = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        orderBy: { [sortField]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          organization: { select: { id: true, name: true } },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
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
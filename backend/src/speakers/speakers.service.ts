import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSpeakerDto } from './dto/create-speaker.dto';
import { UpdateSpeakerDto } from './dto/update-speaker.dto';
import {
  isForeignKeyViolation,
  throwPrismaError,
} from '../common/prisma-error.util';

@Injectable()
export class SpeakersService {
  constructor(private readonly prisma: PrismaService) {}

  create(createSpeakerDto: CreateSpeakerDto) {
    return this.prisma.speaker.create({ data: createSpeakerDto });
  }

  findAll() {
    return this.prisma.speaker.findMany();
  }

  async findOne(id: string) {
    const speaker = await this.prisma.speaker.findUnique({
      where: { id },
      include: { sessions: { include: { session: true } } },
    });
    if (!speaker) {
      throw new NotFoundException(`Speaker with id ${id} not found`);
    }
    return speaker;
  }

  async update(id: string, updateSpeakerDto: UpdateSpeakerDto) {
    await this.findOne(id);
    try {
      return await this.prisma.speaker.update({
        where: { id },
        data: updateSpeakerDto,
      });
    } catch (error) {
      throwPrismaError(error);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.speaker.delete({ where: { id } });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Cannot delete the speaker because they are assigned to one or more sessions',
        );
      }
      throwPrismaError(error);
    }
  }
}
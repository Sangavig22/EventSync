import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddOrganizationMemberDto } from './dto/add-organization-member.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';
import {
  isForeignKeyViolation,
  throwPrismaError,
} from '../common/prisma-error.util';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createOrganizationDto: CreateOrganizationDto) {
    return this.prisma.organization.create({ data: createOrganizationDto });
  }

  findAll() {
    return this.prisma.organization.findMany();
  }

  async findOne(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        members: { include: { user: true } },
        events: true,
      },
    });
    if (!organization) {
      throw new NotFoundException(`Organization with id ${id} not found`);
    }
    return organization;
  }

  async update(id: string, updateOrganizationDto: UpdateOrganizationDto) {
    await this.findOne(id);
    try {
      return await this.prisma.organization.update({
        where: { id },
        data: updateOrganizationDto,
      });
    } catch (error) {
      throwPrismaError(error);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.organization.delete({ where: { id } });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Cannot delete the organization because it has members or events',
        );
      }
      throwPrismaError(error);
    }
  }

  async addMember(
    organizationId: string,
    addOrganizationMemberDto: AddOrganizationMemberDto,
  ) {
    await this.findOne(organizationId);

    const user = await this.prisma.user.findUnique({
      where: { id: addOrganizationMemberDto.userId },
    });
    if (!user) {
      throw new NotFoundException(
        `User with id ${addOrganizationMemberDto.userId} not found`,
      );
    }

    const existing = await this.prisma.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId: addOrganizationMemberDto.userId,
          organizationId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'User is already a member of this organization',
      );
    }

    return this.prisma.organizationMember.create({
      data: { ...addOrganizationMemberDto, organizationId },
    });
  }

  async listMembers(organizationId: string) {
    await this.findOne(organizationId);
    return this.prisma.organizationMember.findMany({
      where: { organizationId },
      include: { user: true },
    });
  }

  async updateMember(
    organizationId: string,
    userId: string,
    updateOrganizationMemberDto: UpdateOrganizationMemberDto,
  ) {
    await this.findOne(organizationId);
    const membership = await this.prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!membership) {
      throw new NotFoundException(
        `User ${userId} is not a member of organization ${organizationId}`,
      );
    }
    return this.prisma.organizationMember.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: updateOrganizationMemberDto,
      include: { user: true },
    });
  }

  async removeMember(organizationId: string, userId: string) {
    await this.findOne(organizationId);
    const membership = await this.prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!membership) {
      throw new NotFoundException(
        `User ${userId} is not a member of organization ${organizationId}`,
      );
    }
    await this.prisma.organizationMember.delete({
      where: { userId_organizationId: { userId, organizationId } },
    });
  }
}
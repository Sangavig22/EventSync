import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

type RequestWithUser = {
  user?: { userId?: string };
  params?: { id?: string };
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<OrganizationRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<RequestWithUser>();

    const user = request.user;

    if (!user?.userId) {
      throw new ForbiddenException('Access denied');
    }

    const organizationId = request.params?.id;

    if (!organizationId) {
      throw new ForbiddenException('Organization id missing');
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId: user.userId,
          organizationId,
        },
      },
      select: { role: true },
    });

    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of this organization',
      );
    }

    if (!requiredRoles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient role for this action');
    }

    return true;
  }
}
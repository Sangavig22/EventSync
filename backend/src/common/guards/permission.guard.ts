import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ORG_CONTEXT_KEY,
  OrganizationContext,
} from '../decorators/organization-context.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { Permission, ROLE_PERMISSIONS } from '../authorization/permissions';

type RequestWithUser = {
  user?: { userId?: string };
  params?: Record<string, string | undefined>;
};

const DEFAULT_ORG_CONTEXT: OrganizationContext = {
  kind: 'param',
  param: 'id',
};

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions =
      this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const user = request.user;

    if (!user?.userId) {
      throw new ForbiddenException('Access denied');
    }

    const orgContext =
      this.reflector.getAllAndOverride<OrganizationContext>(ORG_CONTEXT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_ORG_CONTEXT;

    const organizationId = await this.resolveOrganizationId(
      orgContext,
      request,
    );

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

    const allowedPermissions: readonly Permission[] =
      ROLE_PERMISSIONS[membership.role as OrganizationRole] ?? [];

    const hasAll = requiredPermissions.every((permission) =>
      allowedPermissions.includes(permission),
    );

    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions for this action');
    }

    return true;
  }

  private async resolveOrganizationId(
    orgContext: OrganizationContext,
    request: RequestWithUser,
  ): Promise<string> {
    if (orgContext.kind === 'param') {
      const organizationId = request.params?.[orgContext.param];

      if (!organizationId) {
        throw new ForbiddenException('Organization id missing');
      }

      return organizationId;
    }

    const id = request.params?.[orgContext.param];

    if (!id) {
      throw new ForbiddenException('Organization id missing');
    }

    if (orgContext.model === 'event') {
      const event = await this.prisma.event.findUnique({
        where: { id },
        select: { organizationId: true },
      });

      if (!event) {
        throw new ForbiddenException('Event not found');
      }

      return event.organizationId;
    }

    throw new ForbiddenException('Unsupported organization context');
  }
}
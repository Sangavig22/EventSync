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

    if (orgContext.kind === 'userMembership') {
      return this.assertPermissionsInAnyMembership(
        user.userId,
        requiredPermissions,
      );
    }

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

  private async assertPermissionsInAnyMembership(
    userId: string,
    requiredPermissions: Permission[],
  ): Promise<boolean> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      select: { role: true },
    });

    if (memberships.length === 0) {
      throw new ForbiddenException('You are not a member of any organization');
    }

    const allowedPermissions = new Set<Permission>();
    for (const membership of memberships) {
      for (const permission of ROLE_PERMISSIONS[
        membership.role as OrganizationRole
      ] ?? []) {
        allowedPermissions.add(permission);
      }
    }

    const hasAll = requiredPermissions.every((permission) =>
      allowedPermissions.has(permission),
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

    if (orgContext.kind === 'resource') {
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

      if (orgContext.model === 'session') {
        const session = await this.prisma.session.findUnique({
          where: { id },
          select: { event: { select: { organizationId: true } } },
        });

        if (!session) {
          throw new ForbiddenException('Session not found');
        }

        return session.event.organizationId;
      }
    }

    throw new ForbiddenException('Unsupported organization context');
  }
}
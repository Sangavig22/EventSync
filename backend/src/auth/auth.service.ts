import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'crypto';
import { throwPrismaError } from '../common/prisma-error.util';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto/register.dto';
import { LoginDto } from './dto/signin.dto/signin.dto';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await argon2.hash(dto.password);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          passwordHash,
        },
      });
    } catch (error) {
      throwPrismaError(error);
    }

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    };
  }

  async signin(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);

    const accessToken = await this.signAccessToken(user.id, user.email);
    const session = await this.createSession(user.id);

    return {
      accessToken,
      ...session,
      user,
    };
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const sessionId = this.parseSessionId(refreshToken);

    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
    });

    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const tokenValid = await argon2.verify(
      session.refreshTokenHash,
      refreshToken,
    );

    if (!tokenValid) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.validateRefreshUser(session.userId);

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const accessToken = await this.signAccessToken(user.id, user.email);
    const newSession = await this.createSession(user.id);

    return {
      accessToken,
      ...newSession,
      user,
    };
  }

  async logout(refreshToken: string) {
    if (!refreshToken) {
      return { message: 'Logged out successfully' };
    }

    const sessionId = this.parseSessionId(refreshToken);

    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
    });

    if (session && session.revokedAt === null) {
      const tokenValid = await argon2.verify(
        session.refreshTokenHash,
        refreshToken,
      );

      if (tokenValid) {
        await this.prisma.authSession.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
      }
    }

    return { message: 'Logged out successfully' };
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  private async signAccessToken(userId: string, email: string) {
    return this.jwtService.signAsync({
      sub: userId,
      email,
    });
  }

  private async createSession(userId: string) {
    const sessionId = randomUUID();
    const refreshToken = `${sessionId}.${randomBytes(32).toString('hex')}`;
    const refreshTokenHash = await argon2.hash(refreshToken);

    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash,
        expiresAt,
      },
    });

    return {
      sessionId,
      refreshToken,
      expiresAt,
    };
  }

  private parseSessionId(refreshToken: string) {
    const [sessionId, payload] = refreshToken.split('.');

    if (!sessionId || !payload) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return sessionId;
  }

  private async validateRefreshUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }
}
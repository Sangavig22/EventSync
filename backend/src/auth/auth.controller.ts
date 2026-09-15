import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto/register.dto';
import { LoginDto } from './dto/signin.dto/signin.dto';
import type { Request, Response } from 'express';



@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

@Post('signin')
@HttpCode(HttpStatus.OK)
async signin(
  @Body() dto: LoginDto,
  @Res({ passthrough: true }) res: Response,
) {
  const result = await this.authService.signin(dto);

  res.cookie('refresh_token', result.refreshToken, {
    httpOnly: true,
    secure: false, // local HTTP development
    sameSite: 'lax',
    path: '/auth/refresh',
    maxAge: 24 * 60 * 60 * 1000,
  });

  return {
    accessToken: result.accessToken,
    user: result.user,
  };
}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies['refresh_token'];
    const result = await this.authService.refresh(refreshToken);

    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: false, // local HTTP development
      sameSite: 'lax',
      path: '/auth/refresh',
      maxAge: 24 * 60 * 60 * 1000,
    });

    return {
      accessToken: result.accessToken,
      user: result.user,
      sessionId: result.sessionId,
      expiresAt: result.expiresAt,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies['refresh_token'];
    const result = await this.authService.logout(refreshToken);

    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: false, // local HTTP development
      sameSite: 'lax',
      path: '/auth/refresh',
    });

    return result;
  }
}
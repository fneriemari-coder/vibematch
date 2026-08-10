import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthTokenService } from './auth-token.service';
import { EmailService } from './email.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        // Short-lived on purpose now that AuthTokenService issues real
        // refresh sessions — a leaked access token expires fast, and the
        // Flutter DioClient auto-refreshes on 401 (see core/api/dio_client.dart).
        signOptions: { expiresIn: config.get<string>('ACCESS_TOKEN_EXPIRES_IN', '15m') },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, AuthTokenService, EmailService],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}

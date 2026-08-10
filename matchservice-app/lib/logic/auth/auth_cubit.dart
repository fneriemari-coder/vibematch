import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/api/dio_client.dart';
import '../../data/models/user_models.dart';
import '../../data/repositories/auth_repository.dart';

sealed class AuthState {
  const AuthState();
}

class AuthUnknown extends AuthState {
  const AuthUnknown();
}

class AuthUnauthenticated extends AuthState {
  const AuthUnauthenticated();
}

class AuthAuthenticated extends AuthState {
  const AuthAuthenticated(this.user);
  final AppUser user;
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

class AuthError extends AuthState {
  const AuthError(this.message);
  final String message;
}

class AuthCubit extends Cubit<AuthState> {
  AuthCubit(this._repository) : super(const AuthUnknown());

  final AuthRepository _repository;

  Future<void> bootstrap() async {
    final token = await DioClient.readToken();
    if (token == null) {
      emit(const AuthUnauthenticated());
      return;
    }
    try {
      final user = await _repository.me();
      emit(AuthAuthenticated(user));
    } catch (_) {
      await DioClient.clearToken();
      emit(const AuthUnauthenticated());
    }
  }

  Future<void> login(String email, String password) async {
    emit(const AuthLoading());
    try {
      final user = await _repository.login(email, password);
      emit(AuthAuthenticated(user));
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  Future<void> register({
    required String email,
    required String password,
    required String name,
    required String role,
    required String country,
  }) async {
    emit(const AuthLoading());
    try {
      final user = await _repository.register(
        email: email,
        password: password,
        name: name,
        role: role,
        country: country,
      );
      emit(AuthAuthenticated(user));
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  Future<void> logout() async {
    await _repository.logout();
    emit(const AuthUnauthenticated());
  }
}

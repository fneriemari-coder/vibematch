import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/api/dio_client.dart';

sealed class SubscriptionState {
  const SubscriptionState();
}

class SubscriptionIdle extends SubscriptionState {
  const SubscriptionIdle();
}

class SubscriptionProcessing extends SubscriptionState {
  const SubscriptionProcessing();
}

class SubscriptionCheckoutReady extends SubscriptionState {
  const SubscriptionCheckoutReady(this.checkoutUrl);
  final String checkoutUrl;
}

class SubscriptionError extends SubscriptionState {
  const SubscriptionError(this.message);
  final String message;
}

/// Drives PaywallScreen's "Ativar Acesso Premium Instantâneo" CTA.
/// Kicks off a Stripe Checkout session for the plan matching the user's
/// locale (USD Premium/Pro vs BRL) and hands the URL back for the webview.
class SubscriptionCubit extends Cubit<SubscriptionState> {
  SubscriptionCubit(this._client) : super(const SubscriptionIdle());

  final DioClient _client;

  Future<void> startCheckout({
    required String planTier,
    required String currency,
  }) async {
    emit(const SubscriptionProcessing());
    try {
      final response = await _client.dio.post(
        '/billing/checkout',
        data: {'planTier': planTier, 'currency': currency},
      );
      emit(SubscriptionCheckoutReady(response.data['checkoutUrl'] as String));
    } catch (e) {
      emit(SubscriptionError(e.toString()));
    }
  }

  void reset() => emit(const SubscriptionIdle());
}

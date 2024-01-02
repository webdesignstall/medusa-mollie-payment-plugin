import MollieBase from "../core/mollie-base"


abstract class StripeProviderService extends MollieBase {
  static identifier = 'mollie'

  constructor(_, options) {
    super(_, options)
  }

  get paymentIntentOptions() {
    return {}
  }
}

export default StripeProviderService
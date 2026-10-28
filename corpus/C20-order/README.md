# C20-order: order fulfilment

Business project for the corpus row **C20** ([verification index](../../docs/verification-index.md), section 13), the order process of a web shop:
connector tasks, a parallel gateway, an error boundary event with a compensation path, and signals. Like the other C20 projects it is built through the
modeler without hand-made mappings: the connector tasks get theirs from the **connector templates** (`template.apply`; the connector catalog is the project's
own `seed/connectors/*.json`); the signal catch events get none, because the modeler gives a signal catch event no default mapping (see below).

| Element (`seed/processes/order-fulfilment.bpmn20.xml`) | What it shows |
|---|---|
| `lookupCustomer` (`crm.LOOKUP`), `reserveStock` (`inventory.RESERVE`), `chargePayment` (`payment.CHARGE`), `createShipment` (`shipping.CREATE`) | Connector tasks made from templates: `implementation`, `activiti:templateId` / `templateVersion`, one VARIABLE input per action input, one VARIABLE output per action output, the output targets declared with the types of the descriptor. `expectConnectorCall` asserts the exact inbound and outbound variables of each |
| `onReserveCompensate` + `releaseStock` | Compensation boundary event with its handler (`isForCompensation`, linked by an association) |
| `paymentDeclined` + `rollbackOrder` | Error boundary event (`PAYMENT_DECLINED`, thrown by the connector as a `BpmnError`) and a compensation throw event: the stock reservation is released and the order is cancelled |
| `fork` / `join` | Parallel gateway: packing and the shipping label run in parallel |
| `awaitPickup`, `awaitDelivery` | Two signal catch events in a row, `carrierPickedUp` and `orderDelivered`. The payload of `carrierPickedUp` (the carrier) routes the exclusive gateway `carrierGateway` |

## Signals need no mapping (engine finding 37, C20.2)

Neither signal catch event has a mapping, and the payload of both signals reaches the process (`carrier`, `pickedUpAt`, `deliveredTo`, `deliveredAt`; the carrier routes the gateway). Activiti applies no mapping to a
signal catch event: `SignalEventHandler` sets the variables of the signal on the catching execution as process variables. The modeler therefore gives a signal catch event no default mapping (ADR 0006): a `MAP_ALL`
there changes nothing on the engine, and the lint rule `signal-catch-has-mapping` warns about one. The control in the other direction is the process `signalMappingIgnored`: its signal catch event has an
explicit output mapping that renames `carrier` to `renamed`, and the scenario shows that the payload arrives as `carrier` and `renamed` is never set (the one mapping this build writes by hand; the lint warning on it is the point).

## Support code

`inventory.RESERVE`, `payment.CHARGE` and `shipping.CREATE` are harness connector beans ([corpus support](../../docs/corpus-support.md#connectors)); `payment.CHARGE` throws
`BpmnError("PAYMENT_DECLINED")` for the card token `DECLINED`. `crm.LOOKUP` is the existing bean.

`model-expect.json` asserts the mappings as the engine's reader parsed them (inputs, outputs, `MAP_ALL`, none on the expression tasks), `forCompensation`, the error and
signal event definitions and the default flow. The coverage exemption lists `onReserveCompensate`: the engine records no history for compensation boundary events (as in C08).

Run: `scripts/verify-models.sh corpus --project C20-order`

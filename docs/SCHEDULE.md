# Масштабування за розкладом

## Розклад

Файл `infra/main/autoscaling.tf`: дві `aws_appautoscaling_scheduled_action` на тому самому
`aws_appautoscaling_target`, що й політика за CPU. Вони змінюють лише межі, у яких працює target tracking.

| Дія | Коли (Europe/Kyiv) | min | max | Змінні Terraform |
| --- | --- | --- | --- | --- |
| `cloude-tech-lab1-day-min-capacity` | щодня о 08:00, `cron(0 8 * * ? *)` | 2 | 4 | `schedule_day_cron`, `schedule_day_min_capacity` |
| `cloude-tech-lab1-night-min-capacity` | щодня о 22:00, `cron(0 22 * * ? *)` | 1 | 4 | `schedule_night_cron`, `schedule_night_min_capacity` |

Отже, день триває 14 годин (08:00-22:00), ніч 10 годин (22:00-08:00). Максимум в обох діях - 4, як і в
`autoscaling_max_capacity`, тож розклад не обмежує масштабування під навантаженням.

Часовий пояс задано параметром `timezone = "Europe/Kyiv"` (`schedule_timezone`), а не перерахунком у UTC.
Тоді перехід на літній час (UTC+3) і назад (UTC+2) AWS враховує сам, і дії завжди спрацьовують о 08:00 і 22:00
за київським часом.

### Чому саме 08:00 і 22:00

- Користувачі сервісу - у Києві (лабораторна, студенти і викладач). Активність припадає на навчальний і робочий
  день та вечір, після 22:00 запитів майже немає, а з 22:00 до 08:00 сервісом практично не користуються.
- Друга задача потрібна вдень не через нестачу потужності (одна задача тримає ~840 запитів/с, див.
  [loadtest/README.md](../loadtest/README.md)), а заради доступності: якщо єдина задача впаде або її замінює
  деплой, друга продовжує відповідати, поки ECS запускає нову. Задачі розкладено по двох зонах доступності
  (дві приватні підмережі), тож друга задача захищає і від проблем однієї зони.
- Уночі одна задача - свідомий компроміс: при її падінні буде хвилина-дві помилок, поки ECS підніме нову.
  Для нічного трафіку це прийнятно, а економія - нижче.
- Друга задача стає в стрій приблизно за 1.5 хв після 08:00 (заміри нижче). Якщо потрібно мати дві задачі
  рівно о 08:00, досить поставити `schedule_day_cron = "cron(55 7 * * ? *)"`.

### Як розклад поєднується з target tracking

- Вдень `min_capacity = 2`. Якщо задач менше, Application Auto Scaling одразу піднімає `desiredCount` до 2
  (activity з причиною `minimum capacity was set to 2`). Політика за CPU може додати ще до 4, але знімати нижче 2
  не буде.
- О 22:00 `min_capacity` стає 1. Саме зниження мінімуму задач не вилучає: другу задачу знімає політика за CPU,
  коли її alarm `AlarmLow` (CPU < 54% протягом 15 хв) у стані ALARM. Якщо о 22:00 сервіс простоює, alarm уже
  в ALARM, і задача зникає за кілька секунд (так було в перевірці нижче). Якщо о 22:00 є навантаження, друга
  задача лишиться, доки воно не спаде - це правильна поведінка.
- У `aws_appautoscaling_target` додано `lifecycle { ignore_changes = [min_capacity] }`. Інакше вдень
  `terraform plan` показував би розбіжність 2 → 1, а `terraform apply` повертав би мінімум до
  `autoscaling_min_capacity` посеред дня. Тепер мінімумом керує розклад, а `autoscaling_min_capacity` задає
  лише значення під час створення target.

## Чому вночі 1, а не 0

ECS за ALB не запускає задачу у відповідь на запит. Запит потрапляє на ALB, а в target group немає жодної
зареєстрованої задачі, тож ALB одразу відповідає `503 Service Temporarily Unavailable`. Нову задачу запустив би
лише alarm автомасштабування, а він бачить метрики з затримкою в хвилину і більше. Політика за CPU з нуля
взагалі не масштабує: без задач немає метрики CPU. Навіть з окремим alarm на `RequestCount` перші користувачі
отримували б 503, поки задача стартує, реєструється в target group і проходить health check (у заміру нижче це
~30 с від запуску до реєстрації, плюс час на спрацювання alarm). Платформи на кшталт Cloud Run чи Lambda
тримають запит, поки піднімається екземпляр, ECS Fargate за ALB так не вміє.

Тому `schedule_night_min_capacity` і `schedule_day_min_capacity` мають validation `>= 1`.

## Економія за місяць

Ціни Fargate в eu-central-1 (Linux, x86, on-demand), чинні з 2026-11-01, взято з офіційного AWS Price List API
(`aws pricing get-products --service-code AmazonECS`, usagetype `EUC1-Fargate-vCPU-Hours:perCPU` і
`EUC1-Fargate-GB-Hours`; той самий файл доступний за адресою
https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/eu-central-1/index.json),
сторінка з цінами: https://aws.amazon.com/fargate/pricing/.

| Ресурс | Ціна |
| --- | --- |
| vCPU | $0.04656 за vCPU-годину |
| Пам'ять | $0.00511 за ГБ-годину |

Одна задача 0.25 vCPU / 512 МБ:

```
0.25 × 0.04656 + 0.5 × 0.00511 = 0.011640 + 0.002555 = $0.014195 за годину
```

Місяць - 730 годин, ніч - 10 із 24 годин, тобто 730 × 10 / 24 = 304.2 години на місяць.

| Варіант | Задачі-годин за місяць (мінімум) | Вартість мінімуму |
| --- | --- | --- |
| Постійно min 2 | 2 × 730 = 1 460 | 1 460 × 0.014195 = $20.72 |
| Розклад: 2 вдень, 1 вночі | 730 + 425.8 = 1 155.8 | 1 155.8 × 0.014195 = $16.41 |
| **Економія** | 304.2 | **304.2 × 0.014195 = $4.32 на місяць** (~21%, ~$51.8 на рік) |

Пояснення до розрахунку:

- рахується лише мінімальна кількість задач; задачі, які додає політика за CPU під навантаженням, однакові
  в обох варіантах;
- ALB, NAT Gateway, RDS і Redis від розкладу не залежать, тому в різницю не входять;
- Fargate тарифікує посекундно (мінімум 1 хв), тож секунди, поки задача стартує чи зупиняється, на суму не
  впливають;
- якщо додатково тримати 1 задачу у вихідні (ще 2 × 14 = 28 годин на тиждень), економія зросла б до
  (304.2 + 28 × 4.35) × 0.014195 ≈ $6.05 на місяць. Цього не зроблено, бо умова просить лише день і ніч.

## Перевірка, що дії спрацьовують

Щоб не чекати 22:00 і 08:00, розклад тимчасово поставлено на найближчі хвилини, без зміни коду:

```powershell
terraform apply -var 'schedule_day_cron=cron(40 17 * * ? *)' -var 'schedule_night_cron=cron(47 17 * * ? *)'
```

`aws application-autoscaling describe-scheduled-actions --service-namespace ecs` під час тесту:

```json
[
  { "Name": "cloude-tech-lab1-day-min-capacity", "Schedule": "cron(40 17 * * ? *)", "Timezone": "Europe/Kyiv", "Min": 2, "Max": 4 },
  { "Name": "cloude-tech-lab1-night-min-capacity", "Schedule": "cron(47 17 * * ? *)", "Timezone": "Europe/Kyiv", "Min": 1, "Max": 4 }
]
```

До тесту сервіс мав min 1, max 4 і 1 задачу. Хронологія 17.11.2026 (київський час) з
`describe-scaling-activities` і подій ECS-сервісу:

| Час | Подія | Джерело |
| --- | --- | --- |
| 17:40:42 | `Setting min capacity to 2 and max capacity to 4`, причина `scheduled action name cloude-tech-lab1-day-min-capacity was triggered` | scaling activity |
| 17:40:42 | `Setting desired count to 2`, причина `minimum capacity was set to 2` | scaling activity |
| 17:40:44 | `has started 1 tasks` | ECS |
| 17:41:13 | `registered 1 targets in target-group` | ECS |
| 17:41:21 | `has reached a steady state`, задач 2 з 2 | ECS |
| 17:47:01 | `Setting min capacity to 1 and max capacity to 4`, причина `scheduled action name cloude-tech-lab1-night-min-capacity was triggered` | scaling activity |
| 17:47:14 | `Setting desired count to 1`, причина `monitor alarm ...AlarmLow... in state ALARM triggered policy cloude-tech-lab1-cpu-target-tracking` | scaling activity |
| 17:47:17 | `has stopped 1 running tasks` | ECS |
| 17:47:27 | `deregistered 1 targets`, `has begun draining connections`, `has reached a steady state` | ECS |

Що видно:

- дія спрацьовує протягом хвилини після вказаного часу (17:40:42 для 17:40, 17:47:01 для 17:47);
- вдень друга задача обслуговує запити через ~40 с після спрацювання дії;
- уночі задачу зняла не сама дія, а політика за CPU: `AlarmLow` був у стані ALARM ще з 14.11 (сервіс простоював),
  і щойно мінімум став 1, політика зменшила кількість задач. Задача пройшла через deregistration і draining, як
  при звичайному scale-in.

Після тесту розклад повернуто (`terraform apply` без `-var`), `describe-scheduled-actions` показує
`cron(0 8 * * ? *)` і `cron(0 22 * * ? *)` з `Europe/Kyiv`, а `terraform plan` - `No changes`.

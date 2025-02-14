# Скрипт автоматических задач SingularityFinance

Этот скрипт предназначен для автоматизации выполнения задач SingularityFinance.
Подписывайтесь на мой Твиттер для получения большего количества скриптов: https://x.com/beiyue66 (твиттер создателя если что)

## Функции

- Получение средств из крана
- Кроссчейн операции
- Обмен SFI и WSFI
- Стейкинг, анстейкинг, получение наград
- Поддержка параллельной обработки нескольких кошельков
- Полностью автоматическая работа, не требует вмешательства человека

## Инструкция по использованию

1. Убедитесь, что Node.js установлен в системе

2. Клонируйте репозиторий:
git clone проект на локальный компьютер

3. Установите зависимости:
npm install

3.1 От себя, если в самом начале выдает ошибку, попробуй
npm uninstall ethers
npm install ethers@5

## Конфигурация

1. В файле `.env` в корневом каталоге добавьте API ключ Anti-captcha:

2. В файл `config/private_key.list` добавьте приватные ключи кошельков, по одному на строку:

## Использование

Запустите скрипт:
node index.js

Скрипт запустит отдельный процесс для каждого кошелька, будет работать в бесконечном цикле, засыпая на 24 часа после каждого раунда задач.

## Внимание

- Этот скрипт использует Anti-captcha для решения капчи. Пожалуйста, убедитесь, что у вас достаточно средств на Anti-captcha.
- Ссылка для регистрации в Anti-captcha: [https://getcaptchasolution.com/lhwl0mkjf2](https://getcaptchasolution.com/lhwl0mkjf2)
- Скрипт полностью открыт и работает локально, использование на ваш страх и риск.
- Рекомендуется использовать новый кошелек, автор не несет ответственности за убытки, вызванные использованием скрипта.
- Настройте параметры работы в зависимости от возможностей вашего оборудования, чтобы избежать чрезмерного использования системных ресурсов.

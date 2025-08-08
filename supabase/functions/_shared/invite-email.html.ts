const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Приглашение в FinTrackApp</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #f4f4f4;
      margin: 0;
      padding: 20px;
    }
    .container {
      background-color: #ffffff;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
    }
    p {
      color: #555;
      line-height: 1.6;
    }
    .button {
      display: inline-block;
      background: #0066cc;
      color: #ffffff;
      padding: 12px 25px;
      text-decoration: none;
      border-radius: 5px;
      font-weight: bold;
      margin-top: 10px;
    }
    .footer {
      margin-top: 20px;
      font-size: 12px;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Вас пригласили в рабочее пространство</h1>
    <p>Пользователь <strong>{{inviter_email}}</strong> приглашает вас присоединиться к рабочему пространству "<strong>{{workspace_name}}</strong>" с ролью <strong>{{role}}</strong>.</p>

    <a href="{{accept_url}}" class="button">
      Принять приглашение
    </a>

    <p class="footer">Это приглашение действительно до {{expires_at}}.</p>
    <p class="footer">Если вы не ожидали этого приглашения, вы можете безопасно его проигнорировать.</p>
  </div>
</body>
</html>
`;
export default emailHtml;

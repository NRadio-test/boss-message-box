UPDATE admins
SET password_hash = 'pbkdf2-sha256$100000$nVAZexYMWbKMc86O0pGZFg$OZ2s1PzKoJcnisM1p8n_zHWnL-t80zYEfwEJjARNs-Y',
    updated_at = unixepoch() * 1000
WHERE username = 'zd';

UPDATE admins
SET password_hash = 'pbkdf2-sha256$100000$jiAxALcEdniEFcw8VxEBxA$hLDNsFYlWCGIEKu3mmJ_9Plinhzoq6XUg4SGcEXJ6e4',
    updated_at = unixepoch() * 1000
WHERE username = 'mm';

UPDATE admins
SET password_hash = 'pbkdf2-sha256$100000$vwi6vv3gga6RL-tn-JfeuA$f-p2Wg88zQTFA9_dtCYEyMeaK4ZBGqvZatO2Tbz7Ij8',
    updated_at = unixepoch() * 1000
WHERE username = 'fa';

UPDATE admins
SET password_hash = 'pbkdf2-sha256$100000$QUvTs5NL9IJQFZvp0N0wXQ$RaiWw0DYKVoXD1VGMRdv_yPuJcifzNC7MhRognnoiaY',
    updated_at = unixepoch() * 1000
WHERE username = 'ceshi';

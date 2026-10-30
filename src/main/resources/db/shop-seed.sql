USE gomoku;

INSERT INTO shop_item (id, cat, name, price, colors, glyph, img) VALUES
('board-default',  'board',  '原木',   0, '{"--board":"#E8C286","--board-line":"#8B6B43"}', NULL, NULL),
('board-walnut',   'board',  '胡桃木', 600, '{"--board":"#C89A5B","--board-line":"#6B4A2A"}', NULL, NULL),
('board-beech',    'board',  '浅榉',   400, '{"--board":"#F0D9A8","--board-line":"#A8814F"}', NULL, NULL),
('board-obsidian', 'board',  '曜石',   800, '{"--board":"#3A3F44","--board-line":"#8A9299"}', NULL, NULL),
('board-bamboo',   'board',  '竹青',   500, '{"--board":"#C9D2A5","--board-line":"#6F7A4D"}', NULL, NULL),
('board-lacquer',  'board',  '朱漆',   800, '{"--board":"#A8362B","--board-line":"#5E1F18"}', NULL, NULL),
('avatar-buns',    'avatar', '双丸子', 0, NULL, NULL, 'assets/avatars/avatar01.png'),
('avatar-beard',   'avatar', '络腮胡', 200, NULL, NULL, 'assets/avatars/avatar02.png'),
('avatar-crop',    'avatar', '短发郎', 200, NULL, NULL, 'assets/avatars/avatar03.png'),
('avatar-braids',  'avatar', '双辫丫丫', 300, NULL, NULL, 'assets/avatars/avatar04.png'),
('avatar-pony',    'avatar', '马尾琴琴', 300, NULL, NULL, 'assets/avatars/avatar05.png'),
('avatar-bald',    'avatar', '光头师父', 400, NULL, NULL, 'assets/avatars/avatar06.png'),
('avatar-bob',     'avatar', '波波阿姐', 400, NULL, NULL, 'assets/avatars/avatar07.png');

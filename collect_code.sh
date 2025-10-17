#!/bin/bash

# --- 配置 ---
# 设置输出文件的路径
# $HOME 会自动展开为你的主目录, 例如 /home/eson
# 所以这个路径就是 ~/Documents/ai.txt
OUTPUT_FILE="$HOME/Documents/ai.txt"
# 确保目标目录存在
mkdir -p "$(dirname "$OUTPUT_FILE")"


# --- 脚本主体 ---

# 1. 清空或创建输出文件，以便每次运行都是全新的内容
> "$OUTPUT_FILE"
echo "项目代码汇总" > "$OUTPUT_FILE"
echo "生成时间: $(date)" >> "$OUTPUT_FILE"
echo "项目路径: $(pwd)" >> "$OUTPUT_FILE"
echo -e "\n============================================================\n" >> "$OUTPUT_FILE"


# 2. 使用 'find' 命令查找所有相关文件并处理
#    -type f : 只查找文件
#    -not -path "./.git/*" : 排除 .git 目录
#    -not -path "./node_modules/*" : 排除 node_modules 目录
#    -not -path "./.vscode/*" : 排除 .vscode 目录
#    -not -name "package-lock.json" : 排除 package-lock.json 文件
find . -type f \
  -not -path "./.git/*" \
  -not -path "./node_modules/*" \
  -not -path "./.vscode/*" \
  -not -name "package-lock.json" \
| while read -r file; do
    # 3. 对于找到的每一个文件，先打印一个清晰的分隔符和文件名
    echo "--- 文件路径: $file ---" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE" # 加一个空行
    
    # 4. 使用 'cat' 命令将文件内容追加到输出文件中
    cat "$file" >> "$OUTPUT_FILE"
    
    # 5. 在文件内容后添加一个结束标记和两个换行符，让格式更清晰
    echo "" >> "$OUTPUT_FILE"
    echo "--- 文件结束: $file ---" >> "$OUTPUT_FILE"
    echo -e "\n\n" >> "$OUTPUT_FILE"
done


# --- 完成提示 ---
echo "✅ 成功！项目代码已全部汇总到: $OUTPUT_FILE"



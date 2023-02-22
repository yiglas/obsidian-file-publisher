# Obsidian Blog Publisher

Obsidian plugin that allows you to publish a file to a POST endpoint.

# Configure

Enter the POST endpoint url

Enter the API key for the endpoint

Enter the API secret for the endpoint

# Create a new blog

1. Create a template with the following header

   ```
   ---
   title:
   excerpt: ''
   timestamp: {{date:MMM D, YYYY}}
   ---
   ```

2. Create a new note.

3. Insert the by executing the `Templates: Insert template` command

4. Write your blog

5. Right click on the Note and select `Publish file`
